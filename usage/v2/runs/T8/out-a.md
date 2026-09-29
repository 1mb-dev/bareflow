# Sizing a `list-image-[url(...)]` marker

## Why Tailwind size utilities don't reach it

`list-style-image` renders through the `::marker` pseudo-element, and `::marker` only
accepts a small allow-listed set of CSS properties: `content`, the `font` properties,
`color`, `white-space`, `direction`, `unicode-bidi`, plus `animation`/`transition`.
`width` and `height` are not on that list, so browsers ignore them on `::marker` by
spec. [memory]

That means this is not a Tailwind gap you can patch by finding the right utility -
`marker:w-4`, `[&::marker]:size-4`, `[&::marker]:w-4` all compile to real CSS, but the
browser discards the width/height declaration on `::marker` regardless of how it got
there. There is no CSS-level way to set a marker box's dimensions. [memory]

The attached Tailwind docs for `list-style-image` confirm the utility only ever sets
the `list-style-image` property itself - to a URL, to a `var()` via the
`list-image-(<custom-property>)` shorthand, or to `none` - and nothing in that utility
set does sizing: [doc]

```html
<ul class="list-image-[url(/img/checkmark.png)]">
  <li>5 cups chopped Porcini mushrooms</li>
</ul>
```

```html
<ul class="list-image-(--my-list-image)">
  <!-- shorthand for list-image-[var(--my-list-image)] -->
</ul>
```

```html
<ul class="list-image-none">
  <!-- removes the marker image -->
</ul>
```

The only variation the docs show is responsive swapping of the whole utility (e.g.
`md:list-image-[url(/img/checkmark.png)]`), not resizing. [doc]

## Fix 1 (recommended): stop using `list-style-image`, style the marker yourself

Drop the marker mechanism entirely - `list-none` on the `<ul>` - and render your own
box per `<li>` that you can size with ordinary Tailwind utilities, because it's no
longer a `::marker`. [memory]

Using a real `<img>` (best if the icon needs alt text or crisp raster scaling):

```html
<ul class="list-none space-y-2">
  <li class="flex items-start gap-2">
    <img src="/img/checkmark.png" alt="" class="mt-1 size-4 shrink-0" />
    <span>5 cups chopped Porcini mushrooms</span>
  </li>
</ul>
```

Using a `before:` pseudo-element (keeps markup free of an extra `<img>`, works well
for SVG icons):

```html
<ul class="list-none space-y-2">
  <li class="relative pl-6 before:absolute before:left-0 before:top-1
             before:h-4 before:w-4 before:content-[''] before:bg-contain
             before:bg-no-repeat before:bg-[url('/img/checkmark.png')]">
    5 cups chopped Porcini mushrooms
  </li>
</ul>
```

Either way you get full control: `size-*`, `w-*`/`h-*`, `bg-contain`/`bg-cover`,
`bg-[length:...]`, responsive variants, hover states, all of it, because these are
ordinary boxes, not a `::marker`. [memory]

## Fix 2: keep the real marker, size the asset instead

If you need to keep `list-style-image` for semantic/marker reasons, the marker
renders at the image's own intrinsic size - there's no scaling hook - so the practical
lever is the asset itself: export/crop the PNG at the pixel size you want, or use an
SVG with the `width`/`height` (or `viewBox`) baked in. [memory]

For different sizes at different breakpoints, swap the whole file with Tailwind's
responsive variant, the same mechanism the docs show for toggling the marker on and
off: [doc]

```html
<ul class="list-image-[url(/img/checkmark-16.png)]
           md:list-image-[url(/img/checkmark-24.png)]">
  <li>5 cups chopped Porcini mushrooms</li>
</ul>
```

## Note on `marker:`

Tailwind's `marker:` pseudo-element variant (e.g. `marker:text-red-500`) can restyle
`::marker` for the properties the spec actually allows - color, font-size, etc. - which
is useful for text/counter markers, but it's subject to the same allow-list, so it
cannot size an image marker either. [memory]
