# Avoiding duplicate toctree entries (shallow + deep)

Short answer: yes. Don't list the same documents in two `toctree` directives at all — give each document exactly one real toctree parent, and use the `:hidden:` / `:includehidden:` options to get both a shallow visible view and a deep complete view from that single hierarchy.

## Why the warning happens

Sphinx builds one document hierarchy from all `toctree` directives in the project: each document is expected to have a single parent, which is used to compute prev/next/parent links and breadcrumbs. When the same document shows up in the body of two different `toctree` directives, Sphinx can't tell which is the "real" parent, and it warns that the document is referenced in multiple toctrees. [memory] Listing the same docs in a shallow toctree and a deep toctree is what's *causing* the warning, not fixing it — so restructuring to avoid the duplication is the right move.

## The documented mechanism: `:hidden:` + `:includehidden:`

The docs describe this exact pattern for getting a shallow, per-page view and one deep/global view without repeating entries:

> A hidden toctree only defines the document hierarchy. It will not insert links into the document at the location of the directive. This makes sense if you have other means of navigation, e.g. through manual links, HTML sidebar navigation, or if you use the `:includehidden:` option on the top-level toctree. [doc]

> If you want one global table of contents showing the complete document structure, you can add the `:includehidden:` option to the top-level toctree directive. All other toctrees on child pages can then be made invisible with the `:hidden:` option. The top-level toctree with `:includehidden:` will then include their entries. [doc]

Applied to your case:

```rst
.. root document (index.rst) — the "shallow" visible entry point
.. toctree::
   :maxdepth: 1

   guide/index
   reference/index
```

```rst
.. guide/index.rst — each document listed here ONCE, as its true child
.. toctree::
   :hidden:

   guide/getting-started
   guide/config
   guide/deploy
```

Then, wherever you want the deep/global listing (e.g. a sitemap page, or a theme's sidebar template), use a toctree with `:includehidden:` at the root instead of retyping the child names:

```rst
.. toctree::
   :includehidden:
   :maxdepth: 3

   guide/index
   reference/index
```

Each document (`guide/getting-started`, etc.) is written in exactly one `toctree` body — its parent's. The shallow view is just the normal, visible rendering at each level; the deep/global view is produced by `:includehidden:` pulling the hidden child toctrees in, without a second copy of the entries anywhere. Note that `:hidden:` "only defines the document hierarchy" [doc] — it doesn't stop the doc from counting toward the one hierarchy, it only suppresses the inline link list on that page.

## If the "shallow" list is really just a curated teaser, not structure

If the shallow list is a hand-picked subset for a landing page (not meant to define parent/child relationships), don't use a `toctree` directive for it at all. A `toctree` directive is what registers hierarchy; a plain cross-reference isn't. Use `:doc:` roles or ordinary links instead, and keep the *real* toctree (the deep one) as the single source of hierarchy:

```rst
See also:

- :doc:`guide/getting-started`
- :doc:`guide/config`
```

This avoids the multiple-toctree warning because the document is still only ever inside one actual `toctree` directive — the teaser list is just hyperlinks. [memory]

## If a document genuinely belongs under two different parents

If it's a real dual-membership case (the page logically sits under two independent sections), pick one location as the canonical toctree parent and link to it from the other section with `:doc:` instead of a second toctree entry. [memory] There's no clean Sphinx-native way to give a document two co-equal toctree parents without the warning — the tree model assumes one parent per node.

## One related gotcha if you keep multiple toctrees on the same page

> The LaTeX writer only refers the maxdepth option of first toctree directive in the document. [doc]

So if you ever combine a hidden deep toctree and a visible shallow toctree on the *same* page, only the first one's `:maxdepth:` is honored for LaTeX output — worth knowing if you build PDF/LaTeX targets, not just HTML.
