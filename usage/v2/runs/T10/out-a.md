# Avoiding "referenced in multiple toctrees" without duplicating entries

## What the attached page covers

The attached Sphinx "Directives" page documents the `toctree` directive and its
options (`:maxdepth:`, `:caption:`, `:numbered:`, `:titlesonly:`, `:glob:`,
`:reversed:`, `:hidden:`, `:includehidden:`), but it does not mention the
"document is referenced in multiple toctrees" warning by name, and it has no
`suppress_warnings` entry list [doc]. That warning and its suppression key live
on Sphinx's configuration page, not on this directives page, so the specifics
below come from general Sphinx knowledge, not the attached file [memory].

## The two real fixes

**1. Stop duplicating the entries — use `:hidden:` + `:includehidden:`, which the
page documents for exactly this shallow/deep split:**

> "If you want one global table of contents showing the complete document
> structure, you can add the `:includehidden:` option to the *top-level*
> toctree directive. All other toctrees on child pages can then be made
> invisible with the `:hidden:` option. The top-level toctree with
> `:includehidden:` will then include their entries." [doc]

and:

> "A hidden toctree only defines the document hierarchy. It will not insert
> links into the document at the location of the directive." [doc]

Concretely: keep one real (visible, shallow) `toctree` that actually declares
the parent/child structure, and stop writing a second directive that lists the
same targets. If you need a deep, full-site listing (e.g. for a sidebar or a
sitemap-style page), let the deep view read the *same* structure instead of
re-declaring it — e.g. a single toctree with a deeper `:maxdepth:` plus
`:includehidden:`, or a theme's sidebar renderer, rather than a second
`toctree::` block enumerating the same docs [doc]. This removes the duplicate
registration instead of silencing the warning.

For the shallow "preview" list on the page itself, replace the second toctree
with plain cross-reference links (`:doc:`\`title <target>\``) instead of a
`toctree` directive. Cross-reference roles don't register toctree parent/child
relationships the way `toctree` does, so a hand-written or generated list of
`:doc:` links gives you a shallow visible listing without touching toctree
membership at all [memory].

Many themes (furo, pydata-sphinx-theme, sphinx-rtd-theme) also let you control
how deep the *rendered sidebar* goes independently of the toctree's own
`:maxdepth:` (theme options such as `navigation_depth`, `titles_only`,
collapsible nav), so a single toctree with a deep `:maxdepth:` can often serve
both the "shallow visible" and "deep navigation" purposes without a second
directive at all [memory].

**2. If you genuinely need the same document reachable from two toctrees**
(e.g. it legitimately belongs under two different sections), suppress just
that warning class rather than restructuring:

```python
# conf.py
suppress_warnings = ["toc.multiple_toctree"]
```

This targets only the multiple-toctree-reference warning, leaving other
toctree/build warnings (missing docs, circular refs, etc.) active [memory].
Note this only quiets the warning — Sphinx still has to pick one toctree as
canonical for "next/previous" and breadcrumb generation when a doc has more
than one parent, so prev/next links may not follow the parent you expect [memory].

## Recommendation

Prefer option 1 (drop the duplicate toctree, use `:hidden:`/`:includehidden:`
or `:doc:` links for the shallow view) since it's a structural fix, not a
warning suppression. Reach for `suppress_warnings = ["toc.multiple_toctree"]`
only when the document truly needs two independent parents and the resulting
prev/next ambiguity is acceptable.
