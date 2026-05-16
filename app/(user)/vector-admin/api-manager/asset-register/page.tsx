"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function AssetRegisterPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Registry of API assets and endpoint definitions." />
      <Panel
        name="panel_asset_register_header"
        className="page-panel-heading"
        title="Asset Register"
        description="Browse and manage the register of API assets and endpoint definitions for this workspace."
      />
      <PageDescription title="Asset Register" />

      <section id="panel">
        <Panel name="asset_register_panel" title="Panel">
          <table className="tree_accordion-dense__table">
            <thead>
              <tr>
                <th className="tree_accordion-dense__th">Prop</th>
                <th className="tree_accordion-dense__th">Type</th>
                <th className="tree_accordion-dense__th">Default</th>
                <th className="tree_accordion-dense__th">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>name</code></td>
                <td className="tree_accordion-dense__td">string</td>
                <td className="tree_accordion-dense__td">—</td>
                <td className="tree_accordion-dense__td">Required. Snake-case, [a-z0-9_]{"{1,64}"}. Addressable substrate ID.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>title</code></td>
                <td className="tree_accordion-dense__td">ReactNode</td>
                <td className="tree_accordion-dense__td">—</td>
                <td className="tree_accordion-dense__td">Renders an &lt;h2&gt; header with .panel__header / .panel__title CSS when present.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>className</code></td>
                <td className="tree_accordion-dense__td">string</td>
                <td className="tree_accordion-dense__td">—</td>
                <td className="tree_accordion-dense__td">Appended to the root panel class.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>children</code></td>
                <td className="tree_accordion-dense__td">ReactNode</td>
                <td className="tree_accordion-dense__td">—</td>
                <td className="tree_accordion-dense__td">Panel body content.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>helpable</code></td>
                <td className="tree_accordion-dense__td">boolean</td>
                <td className="tree_accordion-dense__td">—</td>
                <td className="tree_accordion-dense__td">Pass false to suppress the help icon.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>margin</code></td>
                <td className="tree_accordion-dense__td">[top?, right?, bottom?, left?]</td>
                <td className="tree_accordion-dense__td">"0" per slot</td>
                <td className="tree_accordion-dense__td">CSS string per slot. Tokens: --gap-block-top/right/bottom/left (20px each).</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>padding</code></td>
                <td className="tree_accordion-dense__td">[top?, right?, bottom?, left?]</td>
                <td className="tree_accordion-dense__td">var(--space-4) = 16px per slot</td>
                <td className="tree_accordion-dense__td">CSS string per slot.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>border</code></td>
                <td className="tree_accordion-dense__td">{"{ type?, width?, color? }"}</td>
                <td className="tree_accordion-dense__td">solid / 1px / var(--border)</td>
                <td className="tree_accordion-dense__td">type: solid | dashed | dotted | none. Omit prop = CSS class default.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>background</code></td>
                <td className="tree_accordion-dense__td">string</td>
                <td className="tree_accordion-dense__td">transparent</td>
                <td className="tree_accordion-dense__td">Any CSS colour — hex, token, rgba.</td>
              </tr>
              <tr className="tree_accordion-dense__row">
                <td className="tree_accordion-dense__td"><code>radius</code></td>
                <td className="tree_accordion-dense__td">{"{ top?, right?, bottom?, left? }"}</td>
                <td className="tree_accordion-dense__td">"0" per key</td>
                <td className="tree_accordion-dense__td">Maps to border-radius corners TL/TR/BR/BL. CSS string per key.</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </section>
    </PageContent>
  );
}
