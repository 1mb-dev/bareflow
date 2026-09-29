# Type-aware validators in the Annotated pattern

## Why the asymmetry exists

A `@field_validator`-decorated method is defined as a classmethod on the model, so it already
receives `cls` (the model class) as its first argument [doc, e.g. lines 225-230, 269-272]. From
`cls` plus the field name, you can reach the field's annotation:

```python
from pydantic import BaseModel, field_validator, ValidationInfo

class Model(BaseModel):
    number: int

    @field_validator('number')
    @classmethod
    def check(cls, value, info: ValidationInfo):
        field_type = cls.model_fields[info.field_name].annotation
        ...
```

`info.field_name` (the current field name, when using a field validator) is documented as part
of `ValidationInfo` [doc, line 616]. `cls.model_fields[...].annotation` is standard Pydantic v2
`BaseModel` API, not shown in this page [memory].

A validator attached via `Annotated[...]` metadata (`AfterValidator`, `BeforeValidator`,
`PlainValidator`, `WrapValidator`) is a plain function, not a bound method -- it has no `cls`.
The doc's own rationale for this pattern is reuse: the same `EvenNumber = Annotated[int,
AfterValidator(is_even)]` alias can be dropped into unrelated models and fields [doc, lines
456-482]. A plain function with no class reference has nothing to introspect at call time.

Note that the function *can* still take the optional `ValidationInfo` argument (this applies to
"both the field and model validator callables, in all modes" [doc, line 612]), so it can get
`info.field_name` too -- but `ValidationInfo` does not expose the model class or a
`model_fields` mapping, so field name alone doesn't get you back to an annotation the way `cls`
does [memory: not stated in this doc, but nothing in the `ValidationInfo` properties listed at
lines 612-616 provides model/class access].

## The actual mechanism: hook into schema building, not the model class

Reusable validators don't need the model class -- they need the type they were attached to,
and Pydantic gives you that directly at schema-build time through the same protocol that
`AfterValidator`/`BeforeValidator`/`PlainValidator`/`WrapValidator` are themselves built on
[memory; this protocol is referenced in the page's own sidebar as "Annotated Handlers" under
API Documentation, but its content isn't part of the fetched page, lines 64 and 91].

Instead of passing a bare function to `AfterValidator`, write your own class and implement
`__get_pydantic_core_schema__`. Pydantic calls this at schema-build time and passes `source_type`
-- the type immediately being annotated at that position (e.g. `int`, or the item type if you're
inside `list[Annotated[int, ...]]`) -- plus a `handler: GetCoreSchemaHandler` you can call to get
that type's core schema [memory]:

```python
from typing import Annotated, Any
from pydantic import BaseModel, GetCoreSchemaHandler
from pydantic_core import core_schema

class TypeAwareAfter:
    """Reusable, but the wrapped function learns the annotated type at schema-build time."""
    def __init__(self, factory):
        self.factory = factory  # factory(source_type) -> validator(value) -> value

    def __get_pydantic_core_schema__(
        self, source_type: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        schema = handler(source_type)          # core schema for whatever type this sits on
        bound_validator = self.factory(source_type)  # closes over the real annotation
        return core_schema.no_info_after_validator_function(bound_validator, schema)

def is_even_factory(annotated_type):
    def is_even(value):
        if value % 2 == 1:
            raise ValueError(f'{value} is not even ({annotated_type})')
        return value
    return is_even

class Model(BaseModel):
    number: Annotated[int, TypeAwareAfter(is_even_factory)]
```

`TypeAwareAfter` itself stays reusable across models and fields -- exactly like `AfterValidator`
-- but each attachment site gets its own `source_type` resolved at build time, so the validator
closure it produces knows the concrete annotation without ever touching `cls` or `model_fields`
[memory].

## Simpler alternative when you already know the type

If "reusable" only means "a factory I call once per field, not shared blindly across
incompatible types," you don't need the schema-handler hook at all -- just close over the type
when you build the `Annotated` alias, since you already know it while writing that line:

```python
def in_range(min_value, max_value):
    def validator(value):
        if not (min_value <= value <= max_value):
            raise ValueError(f'{value} not in [{min_value}, {max_value}]')
        return value
    return validator

Percentage = Annotated[int, AfterValidator(in_range(0, 100))]
```

This sidesteps the introspection problem entirely: no `cls`, no `__get_pydantic_core_schema__`,
just a validator factory called at class-definition time [memory]. Reach for the
`__get_pydantic_core_schema__` approach only when the same validator object must be dropped onto
annotations it can't know about in advance and needs to branch on the actual resolved type.
