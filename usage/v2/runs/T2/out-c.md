# Annotated validators and access to the field's type

No documentation file was attached to this question, so every claim below is marked [memory].

## Short answer

There is no automatic path. A `@field_validator` method is a classmethod bound to a specific
model, so it already has `cls` and can look up `cls.model_fields[info.field_name].annotation`
[memory]. A function wrapped in `Annotated[..., AfterValidator(fn)]` (or `BeforeValidator`,
`WrapValidator`, `PlainValidator`) is not bound to any model at all - it is plain schema
metadata that could be reused on a model field, a `TypeAdapter`, a `@validate_call` parameter,
or nested inside a generic, so pydantic does not thread a model class through to it [memory].
To get type information into such a function you use one of two mechanisms depending on when
you need the type:

- **You already know the type when you write the `Annotated[...]` alias** - close over it with
  a factory function. This covers the vast majority of "reusable validator" cases [memory].
- **You're writing a validator that must introspect whatever type it ends up attached to**
  (a truly generic, type-agnostic marker) - implement `__get_pydantic_core_schema__` on the
  metadata object; pydantic calls it once per field/type at schema-build time and hands you
  `source_type`, the exact annotation it's attached to [memory].

Separately, the *field name* (not the type) is available at validation time through
`ValidationInfo.field_name`, the same object `@field_validator` methods use, and you get it the
easy way (no custom core schema needed) [memory].

## How `@field_validator` gets there, for contrast

```python
from pydantic import BaseModel, field_validator, ValidationInfo

class Item(BaseModel):
    qty: int

    @field_validator("qty")
    @classmethod
    def check(cls, value: int, info: ValidationInfo) -> int:
        annotation = cls.model_fields[info.field_name].annotation  # int
        ...
        return value
```

`cls` is available because the method lives on the model class; `info.field_name` says which
field is running; `cls.model_fields[...]` is the actual FieldInfo, whose `.annotation` is the
declared type [memory]. Nothing about this is automatic magic - it's just that a bound method
has `cls` for free, and an `Annotated` function does not.

## Option A: closure/factory (you already know the type)

This is the normal case: you're writing `SomeValidator` for a type you're about to name in the
same line.

```python
from typing import Annotated
from pydantic import AfterValidator

def gt(min_value: int):
    def check(value: int) -> int:
        if value <= min_value:
            raise ValueError(f"must be greater than {min_value}")
        return value
    return check

PositiveInt = Annotated[int, AfterValidator(gt(0))]
```

`gt(0)` captures `0` and `int`-shaped intent in a closure at definition time; no runtime
introspection is needed because the author already wrote the type right there [memory].

## Option B: `__get_pydantic_core_schema__` (validator must discover the type)

When the validator itself is meant to be generic - i.e. it's shipped as a reusable marker class
and shouldn't hardcode what it's attached to - implement pydantic's schema-generation protocol.
Pydantic calls this method while building the core schema for the annotated type and passes the
actual annotation as `source_type`, plus a `handler` you call to get the schema that type would
otherwise produce [memory]:

```python
from dataclasses import dataclass
from typing import Annotated, Any

from pydantic import BaseModel, GetCoreSchemaHandler, ValidationInfo
from pydantic_core import core_schema

@dataclass(frozen=True)
class Positive:
    def __get_pydantic_core_schema__(
        self, source_type: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        schema = handler(source_type)  # schema for `source_type`, e.g. int

        def validate(value: Any, info: ValidationInfo) -> Any:
            if value <= 0:
                raise ValueError(
                    f"{info.field_name!r} ({source_type}) must be positive, got {value!r}"
                )
            return value

        return core_schema.with_info_after_validator_function(validate, schema)

PositiveInt = Annotated[int, Positive()]

class Item(BaseModel):
    qty: PositiveInt
```

`source_type` (here `int`) is resolved once per field at schema-build time and closed over by
`validate`; `info.field_name` (here `"qty"`) is resolved per call at validation time [memory].
Between the two, `Positive` gets both pieces of context `@field_validator` gets via `cls`,
without ever being bound to a model.

Caveat: calling `handler(source_type)` applies any remaining `Annotated` metadata after this
entry in the same annotation stack (the normal, composable behavior). `handler.generate_schema(x)`
instead builds a fresh schema for `x` from scratch, ignoring the rest of the stack - reach for
that only if you deliberately want to bypass sibling metadata [memory].

There's also a `GetPydanticSchema` convenience for one-off schema functions without writing a
full class; its exact constructor keyword names have shifted across pydantic 2.x minor
versions, so check them against the installed version before using it [memory].

## Getting just the field name, the easy way

If all you need is `field_name` (not the annotated type), you don't need the core-schema
machinery above - `AfterValidator`/`BeforeValidator`/`WrapValidator`/`PlainValidator` all detect
whether the wrapped function takes a second `info: ValidationInfo` parameter and pass it through
[memory]:

```python
from typing import Annotated
from pydantic import AfterValidator, ValidationInfo

def check_positive(value: int, info: ValidationInfo) -> int:
    if value <= 0:
        raise ValueError(f"{info.field_name} must be positive")
    return value

PositiveInt = Annotated[int, AfterValidator(check_positive)]
```

Caveat: `info.field_name` (and `info.data`, the previously-validated sibling fields) is only
populated when the schema is actually used as a model field. Used standalone - e.g.
`TypeAdapter(PositiveInt).validate_python(5)` or as a `@validate_call` parameter - `field_name`
may be `None` or the parameter name instead, so don't rely on it for non-model use [memory].

## What you still don't get

Neither mechanism hands you the model class itself, other fields' `FieldInfo` (defaults,
aliases, constraints), or the ability to call other validators on the model - `info.data` gives
you already-validated sibling *values*, not their `FieldInfo` objects [memory]. If a "reusable
validator" actually needs that - real cross-field or model-level context - that's precisely the
job `@field_validator` and `@model_validator` are for; `Annotated` metadata is intentionally
decoupled from any one model so it can be reused across models, functions, and generics, and
that decoupling is the reason it can't reach `cls` [memory].
