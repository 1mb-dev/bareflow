# How a reusable Annotated-metadata validator can see the field's type

**Short version:** it can't, through the same channel a `@field_validator` method uses. It needs
a different hook, one that runs at schema-build time rather than validate time.

`ValidationInfo` -- the extra argument both decorator-based field validators and Annotated-metadata
validator functions can optionally take -- exposes already-validated data, user context, the
current validation mode, and "the current field name, if using a field validator" [doc]. It does
not expose the field's annotation or the owning model class; those aren't in the list [doc].

A `@field_validator` method only "sees" the model because of *how it's invoked*, not because of
anything `ValidationInfo` hands it: the decorator applies the method as a class method [doc], so
`cls` is a plain argument it already has:

```python
from pydantic import BaseModel, ValidationInfo, field_validator

class Model(BaseModel):
    number: int

    @field_validator("number")
    @classmethod
    def check(cls, value: int, info: ValidationInfo) -> int:
        field_type = cls.model_fields[info.field_name].annotation  # int
        ...
        return value
```

`info.field_name` plus `cls.model_fields` is how you'd reconstruct the annotation [memory] --
it's assembled from two things you have access to, not delivered as one argument.

Annotated-metadata validators (`AfterValidator`, `BeforeValidator`, `PlainValidator`,
`WrapValidator` wrapping a plain function) don't get a `cls` slot at all:

```python
from typing import Annotated
from pydantic import AfterValidator, BaseModel

def is_even(value: int) -> int:
    if value % 2 == 1:
        raise ValueError(f"{value} is not an even number")
    return value

EvenNumber = Annotated[int, AfterValidator(is_even)]

class Model1(BaseModel):
    my_number: EvenNumber

class Model2(BaseModel):
    other_number: Annotated[EvenNumber, AfterValidator(lambda v: v + 2)]
```
[doc]

`is_even` takes only `value` (optionally `value, info`). The whole point of this pattern is that
`EvenNumber` is the *same object*, reused verbatim across `Model1`, `Model2`, and even inside a
`list[EvenNumber]` [doc] -- so there's no single owning model or field for Pydantic to hand it
even if `ValidationInfo` carried one.

## The actual hook: `__get_pydantic_core_schema__`

To make a reusable Annotated marker type-aware, put an object that implements
`__get_pydantic_core_schema__(self, source_type, handler)` in the metadata instead of (or
alongside) a plain function [memory]. Pydantic calls this once per field, while building the
model's core schema, and passes `source_type` -- the annotation the metadata is attached to
[memory]:

```python
from typing import Annotated, Any
from pydantic import BaseModel, GetCoreSchemaHandler
from pydantic_core import core_schema

class Truncate:
    """Reusable marker: coerces via the annotated type's own constructor."""

    def __get_pydantic_core_schema__(
        self, source_type: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        schema = handler(source_type)  # core schema for the wrapped type

        def validate(value: Any) -> Any:
            return source_type(value)  # source_type captured in the closure

        return core_schema.no_info_after_validator_function(validate, schema)

class Model(BaseModel):
    a: Annotated[int, Truncate()]
    b: Annotated[float, Truncate()]
```
[memory]

`Truncate()` is one reusable object, same idea as `EvenNumber` above, but because it defines
`__get_pydantic_core_schema__`, Pydantic calls that method separately for `Model.a` and `Model.b`
and passes `int` and `float` respectively [memory]. That's the Annotated-pattern analog of what
`cls` gives a `field_validator` method: not the owning model, but the field's own annotation,
resolved at the moment the schema is built and then closed over.

Two things to watch:

- This fires at schema-build time (class creation), not at validate time. The type is fixed once
  per annotation site and baked into the closure; you can't get a different `source_type` on a
  later call. If you need per-call runtime info (which field failed, sibling data), that's still
  `ValidationInfo` inside the `validate` function you return -- and it still won't carry the type
  or the model class [memory].
- `source_type` isn't guaranteed to be identical to `cls` in the sense of "the exact type you'd
  expect": with generics or subclassed usage it can arrive as a parametrized type, so you may need
  `typing.get_origin`/`get_args` on it rather than assuming a plain concrete type [memory].

## If reuse-across-fields is all you need

If the goal is just "run this check on several fields" without per-field type specialization, the
decorator pattern already covers that more directly -- `@field_validator('f1', 'f2', ...)` applies
one method to multiple fields [doc] -- which is the flip side of the trade-off the docs draw
between the two patterns: Annotated favors reuse across types/models, the decorator favors reuse
across fields of one model plus access to `cls` and sibling data [doc].
