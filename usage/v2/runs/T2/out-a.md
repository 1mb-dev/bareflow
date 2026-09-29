# Getting a reusable Annotated validator access to the field's type

## Why `@field_validator` gets this "for free"

`@field_validator` is applied to a class method [doc], and Pydantic binds it as a classmethod, so the function always receives `cls` — the model class itself [doc]. From `cls` you can reach `cls.model_fields[field_name]`, a `FieldInfo` object that carries the real annotation, so a decorator-based validator can look up "what type is this field" any time it needs to, because it lives on the class [memory].

The optional extra argument both decorator- and Annotated-based validators can take is `ValidationInfo`, and it exposes exactly four things: already-validated data (`.data`), user-supplied context (`.context`), the validation mode (`.mode`), and the current field name (`.field_name`) [doc]. There is no `.annotation` or `.model` property on it [doc]. So even a decorator-based validator isn't handed the type directly through `info` — it gets there via `cls`, not via `info`.

## Why a bare Annotated-metadata function can't do the same

A function passed to `AfterValidator`, `BeforeValidator`, `PlainValidator`, or `WrapValidator` inside `Annotated[...]` is a plain function, not bound to any class [doc]. Its only extra argument is that same `ValidationInfo` (`data`/`context`/`mode`/`field_name`) [doc], so it has `field_name` but no handle back to the owning model class, and therefore no way to do the `cls.model_fields[...]` lookup a `@field_validator` method can do [memory]. This is a real, structural gap, not an oversight to work around at the wrong layer — the annotated pattern's whole point is to make the validator reusable and portable across models and fields [doc], so it deliberately has no privileged access to "which class am I on."

## The actual mechanism: `__get_pydantic_core_schema__`

The field's *type* (as opposed to the owning class) is available to Annotated metadata, but at schema-build time, not at per-call validation time. Instead of passing a plain function to `AfterValidator` (etc.), make the metadata object a class that implements `__get_pydantic_core_schema__(self, source_type, handler)`. Pydantic calls this while generating the model's core schema and passes the annotated type in as `source_type`; you close over it when building the actual validator function [memory]. The attached doc's dataclasses section confirms this exact hook and its `handler` argument when it shows Pydantic's own error message for an unsupported type: "implement `__get_pydantic_core_schema__` on your type to fully support it... If you got this error by calling `handler(<some type>)` within `__get_pydantic_core_schema__` then you likely need to call `handler.generate_schema(<some type>)`" [doc].

```python
from typing import Annotated, Any
from pydantic import BaseModel, GetCoreSchemaHandler
from pydantic_core import core_schema

class TypeAwareCheck:
    """Reusable Annotated metadata that knows the type it's attached to."""

    def __get_pydantic_core_schema__(
        self, source_type: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        schema = handler(source_type)          # schema for whatever this wraps

        def validate(value: Any) -> Any:
            # source_type is captured by closure, e.g. int, str, list[int]...
            if source_type is int and value == 0:
                raise ValueError("zero not allowed on int fields")
            return value

        return core_schema.no_info_after_validator_function(validate, schema)

class Model(BaseModel):
    number: Annotated[int, TypeAwareCheck()]
```

Notes on this pattern [memory, not shown in the attached doc]:

- `source_type` is the type at that point in the `Annotated[...]` stack — for `Annotated[int, TypeAwareCheck()]` it is `int`; for `Annotated[list[int], TypeAwareCheck()]` it is `list[int]`.
- `handler(source_type)` continues building the schema for that type (respecting any further Annotated metadata still to resolve). Use `handler.generate_schema(other_type)` instead when you need the schema for a *different* type than `source_type`, to avoid infinite recursion — this is exactly the alternative the doc's error message calls out [doc].
- The hook runs once per field, at class-definition time, so capturing `source_type` in a closure is cheap and the resulting validator is still a plain, reusable object — you instantiate `TypeAwareCheck()` and drop it into any `Annotated[...]` slot, and it introspects whatever type it's paired with each time [memory].
- If you also want per-call `ValidationInfo` (field name, context, etc.) inside the closure, use `core_schema.with_info_after_validator_function(validate, schema)` instead of the `no_info_*` variant, and give `validate` the signature `(value, info)` [memory].

## What this doesn't solve

This gets you the *type/annotation*, not the *owning model class*. There's no supported way for a bare `AfterValidator`/`BeforeValidator`/`PlainValidator`/`WrapValidator` function (or even a `__get_pydantic_core_schema__`-based marker) to reach `cls` the way a `@field_validator` method does — the class doesn't exist yet as a finished object at schema-generation time for the marker, and `ValidationInfo` never carries it [memory]. If you genuinely need the model class (not just the field's type), use the decorator pattern instead [doc], or pass what you need explicitly through `context=` at `model_validate(...)` time, which the doc documents as the supported channel for injecting extra data into validators [doc].

## Summary

| | `@field_validator` method | `AfterValidator`/etc. function via `Annotated` | `__get_pydantic_core_schema__` marker via `Annotated` |
|---|---|---|---|
| Gets owning class (`cls`) | Yes, as bound classmethod [doc] | No [memory] | No [memory] |
| Gets field's annotation | Indirectly, via `cls.model_fields[info.field_name].annotation` [memory] | No — `ValidationInfo` has no such property [doc] | Yes, directly as `source_type`, at schema-build time [doc] |
| Reusable across models/fields | Only by re-declaring per model [memory] | Yes, that's its stated purpose [doc] | Yes, same instance can be dropped into any `Annotated[...]` slot [memory] |
