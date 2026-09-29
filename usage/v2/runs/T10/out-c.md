# Avoiding "referenced in multiple toctrees" without a duplicate shallow/deep toctree

No documentation file was attached to this task, so everything below is general Sphinx knowledge [memory], not sourced from a provided doc.

## Why it happens

Sphinx builds one global document tree and expects each document to have a single toctree parent (that parent relationship drives prev/next links and breadcrumbs) [memory]. Putting the same set of documents into two `toctree::` directives -- one with a shallow `maxdepth` for an overview and one deeper for full navigation -- registers two parents for those documents, which is exactly what triggers "document is referenced in multiple toctrees" [memory].

## Better options than duplicating the toctree

**1. One real (hidden) toctree, plain links for the shallow view**
Keep a single `toctree::` as the actual site structure (deep, usually `:hidden:` if you don't want it rendered inline), and replace the second "shallow" toctree with a plain bullet list of `:doc:` cross-references instead of a second `toctree::` directive. `:doc:` links don't register a toc parent, so they never trigger the warning [memory].

```rst
.. toctree::
   :hidden:
   :maxdepth: 3

   guide/install
   guide/config
   guide/config/advanced
   guide/config/plugins

Overview
--------

- :doc:`guide/install`
- :doc:`guide/config`
```

**2. Let the theme control display depth instead of a second toctree**
Many themes render a collapsible sidebar and expose a config knob for how many levels show by default, so one deep toctree serves both the "shallow first impression" and "deep navigation" needs without a second directive: PyData/Sphinx-Book-Theme's `show_nav_level`/`navigation_depth`, Furo's built-in collapsible sidebar, and the classic RTD theme's `collapse_navigation`/`titles_only` [memory].

```python
# conf.py, e.g. pydata-sphinx-theme
html_theme_options = {
    "show_nav_level": 1,       # renders shallow by default
    "navigation_depth": 4,     # but the full deep tree is there, expandable
}
```

**3. Suppress the specific warning if the duplication is genuinely intentional**
Sphinx lets you suppress warning categories by name via `suppress_warnings` in `conf.py`. Newer Sphinx versions have a toctree-duplication category for this; check `sphinx-build --help`/your installed Sphinx's docs for the exact string, since the name has moved around across versions -- I'm not fully certain of the current spelling for your version [memory, low confidence]. This is a blunt fix compared to options 1-2: it silences the signal rather than removing the structural duplication, so it's best reserved for cases where you deliberately want the same page reachable from two independent toctrees (e.g., a curated "Guides" landing page and a generated "Full Reference" tree) rather than for a shallow/deep pair of the same tree.

```python
# conf.py -- last resort, only if duplication is intentional and unavoidable
suppress_warnings = ["toc.excluded"]  # verify the exact key for your Sphinx version
```

**4. Curated landing page instead of a shallow toctree at all**
If the "shallow" toctree exists just to give a nicer front-page summary, consider a card/grid layout (e.g. the `sphinx-design` extension's `grid`/`card` directives) linking to the same pages via `:doc:`, rather than a toctree. This gets you a richer landing page than a bullet list, still with zero extra toctree parents [memory].

## Recommendation

Prefer option 1 (single hidden deep toctree + `:doc:` links for the shallow page) or option 2 (theme nav-depth setting) over suppressing the warning. Both remove the actual duplication that Sphinx is flagging, rather than just hiding the message, and both are standard, low-maintenance patterns in Sphinx docs sites [memory].
