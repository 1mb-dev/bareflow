# Sizing a `list-image-[url(...)]` marker

## Why Tailwind size utilities don't help

Tailwind's `list-style-image` utilities are `list-image-[<value>]` (sets `list-style-image: <value>`), `list-image-(<custom-property>)` (var() shorthand), and `list-image-none` [doc]. That's the full set — there is no companion size utility, because `list-style-image` has no sibling CSS property to control the rendered size (no `list-style-image-size`) [memory].

The deeper reason `w-*`/`h-*`/`size-*` (or any box-model utility) silently does nothing here is a CSS spec restriction, not a Tailwind gap: `::marker` (and the legacy `list-style-image` box it produces) only honors a small allow-list of properties — mainly `color`, `content`, `font`, `white-space`, `text-combine-upright`, and a few animation-related ones. `width`, `height`, `background-size`, `object-fit`, etc. are explicitly not applied to markers by any current browser [memory]. So even reaching for Tailwind's `marker:` variant (e.g. `marker:content-[url(...)]`) won't let you size the image — the box itself ignores sizing properties.

## Two practical fixes

**1. Pre-size the source asset.** Author the PNG/SVG at the exact pixel size you want it to render (and provide a 2x asset for high-DPI screens). No CSS involved, works everywhere `list-style-image` works, but isn't responsive — a different size at `md:` means swapping the whole image with `md:list-image-[url(...)]`, which the docs do support for responsive variants [doc]:

```html
<ul class="list-image-[url(/img/checkmark-16.png)] md:list-image-[url(/img/checkmark-24.png)]">
  <li>5 cups chopped Porcini mushrooms</li>
</ul>
```

**2. Drop the native marker and fake it with a pseudo-element (the standard approach).** Turn off the marker with `list-none`, then paint the bullet as a sized `background-image` on `::before`, which *does* honor Tailwind's box/background utilities since it's an ordinary block-level box, not a `::marker`:

```html
<ul class="list-none space-y-1">
  <li class="relative pl-6 before:absolute before:left-0 before:top-1
             before:size-4 before:content-['']
             before:bg-[url('/img/checkmark.png')] before:bg-contain before:bg-no-repeat">
    5 cups chopped Porcini mushrooms
  </li>
  <li class="relative pl-6 before:absolute before:left-0 before:top-1
             before:size-4 before:content-['']
             before:bg-[url('/img/checkmark.png')] before:bg-contain before:bg-no-repeat">
    1/2 cup of olive oil
  </li>
</ul>
```

Notes on that pattern [memory, not in doc]:
- `size-4` (Tailwind v4's combined width+height utility) sets the bullet's box; swap it per breakpoint (`md:before:size-6`) the same way the docs show responsive variants on `list-image-*` [doc].
- Use `before:bg-contain` for a scale-to-fit raster/SVG, or `before:bg-[length:16px_16px]` if you need an exact size independent of the box.
- `list-none` only removes the *visual* marker; in Safari+VoiceOver it has historically also stripped the list's accessibility semantics, so add `role="list"` on the `<ul>` (and, if needed, `role="listitem"` on the `<li>`s) to keep it announced as a list [memory].

Either approach is a workaround for a CSS limitation, not a missing Tailwind feature — nothing in the `list-style-image` docs (Quick reference, Basic example, CSS-variable form, `list-image-none`, or the responsive-variant example) offers a sizing knob [doc].
