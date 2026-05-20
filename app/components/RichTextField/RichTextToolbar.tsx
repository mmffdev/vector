"use client";

// RichTextToolbar — Rally-style toolbar above the RichTextField.
// Twenty controls grouped by function with vertical dividers:
//
//   undo redo | font-size font-family paragraph-style |
//   B I U S | colour highlight clear-format |
//   bulleted numbered | outdent indent |
//   link code-block insert-link | table image | align-dropdown
//
// All buttons call editor.chain().focus().<cmd>().run() — TipTap's
// fluent command API. Active state mirrors editor.isActive(...) so
// the buttons highlight when the cursor is inside that mark/node.

import React from "react";
import type { Editor } from "@tiptap/react";
import {
  MdUndo, MdRedo,
  MdFormatBold, MdFormatItalic, MdFormatUnderlined, MdStrikethroughS,
  MdFormatColorText, MdFormatColorFill, MdFormatClear,
  MdFormatListBulleted, MdFormatListNumbered,
  MdFormatIndentDecrease, MdFormatIndentIncrease,
  MdLink, MdCode,
  MdTableChart, MdImage,
  MdFormatAlignLeft, MdFormatAlignCenter, MdFormatAlignRight, MdFormatAlignJustify,
  MdFormatSize,
} from "react-icons/md";

interface RichTextToolbarProps {
  editor: Editor | null;
  disabled?: boolean;
}

export function RichTextToolbar({ editor, disabled }: RichTextToolbarProps) {
  if (!editor) {
    // Editor not mounted yet — render the toolbar shell so the layout
    // doesn't pop. All buttons are no-ops until the editor lands.
    return <div className="rich-text-field__Toolbar" aria-busy="true" />;
  }
  // Bind a non-null alias so closure narrowing doesn't decay across
  // the ReturnType<typeof editor.chain> inference below.
  const ed: Editor = editor;
  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    attrs ? ed.isActive(name, attrs) : ed.isActive(name);
  const isAlign = (dir: "left" | "center" | "right" | "justify") =>
    ed.isActive({ textAlign: dir });

  // Generic chain runner — focus + run, used by every button.
  const run = (fn: (chain: ReturnType<typeof ed.chain>) => unknown) => () => {
    if (disabled) return;
    fn(ed.chain().focus());
  };

  return (
    <div className="rich-text-field__Toolbar" role="toolbar" aria-label="Text formatting">
      {/* History */}
      <ToolGroup>
        <ToolBtn
          title="Undo"
          onClick={run((c) => c.undo().run())}
          disabled={disabled || !editor.can().undo()}
        ><MdUndo size={16} /></ToolBtn>
        <ToolBtn
          title="Redo"
          onClick={run((c) => c.redo().run())}
          disabled={disabled || !editor.can().redo()}
        ><MdRedo size={16} /></ToolBtn>
      </ToolGroup>

      {/* Font size dropdown — uses heading levels 1/2/3 + paragraph */}
      <ToolGroup>
        <select
          className="rich-text-field__Toolbar_Select"
          title="Text style"
          value={
            isActive("heading", { level: 1 }) ? "h1"
            : isActive("heading", { level: 2 }) ? "h2"
            : isActive("heading", { level: 3 }) ? "h3"
            : "p"
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") run((c) => c.setParagraph().run())();
            else if (v === "h1") run((c) => c.toggleHeading({ level: 1 }).run())();
            else if (v === "h2") run((c) => c.toggleHeading({ level: 2 }).run())();
            else if (v === "h3") run((c) => c.toggleHeading({ level: 3 }).run())();
          }}
          disabled={disabled}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <select
          className="rich-text-field__Toolbar_Select"
          title="Font family"
          value={editor.getAttributes("textStyle").fontFamily ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) run((c) => c.unsetFontFamily().run())();
            else run((c) => c.setFontFamily(v).run())();
          }}
          disabled={disabled}
        >
          <option value="">Default font</option>
          <option value="Inter, sans-serif">Sans</option>
          <option value="Georgia, serif">Serif</option>
          <option value="ui-monospace, monospace">Mono</option>
        </select>

        <button
          type="button"
          className="rich-text-field__Toolbar_Btn"
          title="Font size (toggle smaller)"
          onClick={run((c) =>
            isActive("heading", { level: 3 })
              ? c.setParagraph().run()
              : c.toggleHeading({ level: 3 }).run(),
          )}
          disabled={disabled}
        >
          <MdFormatSize size={16} />
        </button>
      </ToolGroup>

      {/* Inline marks */}
      <ToolGroup>
        <ToolBtn
          title="Bold"
          active={isActive("bold")}
          onClick={run((c) => c.toggleBold().run())}
          disabled={disabled}
        ><MdFormatBold size={16} /></ToolBtn>
        <ToolBtn
          title="Italic"
          active={isActive("italic")}
          onClick={run((c) => c.toggleItalic().run())}
          disabled={disabled}
        ><MdFormatItalic size={16} /></ToolBtn>
        <ToolBtn
          title="Underline"
          active={isActive("underline")}
          onClick={run((c) => c.toggleUnderline().run())}
          disabled={disabled}
        ><MdFormatUnderlined size={16} /></ToolBtn>
        <ToolBtn
          title="Strikethrough"
          active={isActive("strike")}
          onClick={run((c) => c.toggleStrike().run())}
          disabled={disabled}
        ><MdStrikethroughS size={16} /></ToolBtn>
      </ToolGroup>

      {/* Colour, highlight, clear */}
      <ToolGroup>
        <label
          className="rich-text-field__Toolbar_ColourBtn"
          title="Text colour"
        >
          <MdFormatColorText size={16} />
          <input
            type="color"
            onChange={(e) => run((c) => c.setColor(e.target.value).run())()}
            disabled={disabled}
          />
        </label>
        <label
          className="rich-text-field__Toolbar_ColourBtn"
          title="Highlight"
        >
          <MdFormatColorFill size={16} />
          <input
            type="color"
            onChange={(e) => run((c) => c.toggleHighlight({ color: e.target.value }).run())()}
            disabled={disabled}
          />
        </label>
        <ToolBtn
          title="Clear formatting"
          onClick={run((c) => c.unsetAllMarks().clearNodes().run())}
          disabled={disabled}
        ><MdFormatClear size={16} /></ToolBtn>
      </ToolGroup>

      {/* Lists */}
      <ToolGroup>
        <ToolBtn
          title="Bulleted list"
          active={isActive("bulletList")}
          onClick={run((c) => c.toggleBulletList().run())}
          disabled={disabled}
        ><MdFormatListBulleted size={16} /></ToolBtn>
        <ToolBtn
          title="Numbered list"
          active={isActive("orderedList")}
          onClick={run((c) => c.toggleOrderedList().run())}
          disabled={disabled}
        ><MdFormatListNumbered size={16} /></ToolBtn>
      </ToolGroup>

      {/* Indent (only meaningful inside lists) */}
      <ToolGroup>
        <ToolBtn
          title="Decrease indent"
          onClick={run((c) => c.liftListItem("listItem").run())}
          disabled={disabled}
        ><MdFormatIndentDecrease size={16} /></ToolBtn>
        <ToolBtn
          title="Increase indent"
          onClick={run((c) => c.sinkListItem("listItem").run())}
          disabled={disabled}
        ><MdFormatIndentIncrease size={16} /></ToolBtn>
      </ToolGroup>

      {/* Link + code */}
      <ToolGroup>
        <ToolBtn
          title="Link"
          active={isActive("link")}
          onClick={() => {
            if (disabled || !editor) return;
            const prev = editor.getAttributes("link").href ?? "";
            const url = window.prompt("Link URL", prev);
            if (url === null) return; // cancelled
            if (url === "") {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
            } else {
              editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            }
          }}
          disabled={disabled}
        ><MdLink size={16} /></ToolBtn>
        <ToolBtn
          title="Code block"
          active={isActive("codeBlock")}
          onClick={run((c) => c.toggleCodeBlock().run())}
          disabled={disabled}
        ><MdCode size={16} /></ToolBtn>
      </ToolGroup>

      {/* Insert table + image */}
      <ToolGroup>
        <ToolBtn
          title="Insert table"
          onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
          disabled={disabled}
        ><MdTableChart size={16} /></ToolBtn>
        <ToolBtn
          title="Insert image (URL)"
          onClick={() => {
            if (disabled || !editor) return;
            const url = window.prompt("Image URL");
            if (!url) return;
            editor.chain().focus().setImage({ src: url }).run();
          }}
          disabled={disabled}
        ><MdImage size={16} /></ToolBtn>
      </ToolGroup>

      {/* Alignment dropdown */}
      <ToolGroup>
        <ToolBtn
          title="Align left"
          active={isAlign("left")}
          onClick={run((c) => c.setTextAlign("left").run())}
          disabled={disabled}
        ><MdFormatAlignLeft size={16} /></ToolBtn>
        <ToolBtn
          title="Align centre"
          active={isAlign("center")}
          onClick={run((c) => c.setTextAlign("center").run())}
          disabled={disabled}
        ><MdFormatAlignCenter size={16} /></ToolBtn>
        <ToolBtn
          title="Align right"
          active={isAlign("right")}
          onClick={run((c) => c.setTextAlign("right").run())}
          disabled={disabled}
        ><MdFormatAlignRight size={16} /></ToolBtn>
        <ToolBtn
          title="Justify"
          active={isAlign("justify")}
          onClick={run((c) => c.setTextAlign("justify").run())}
          disabled={disabled}
        ><MdFormatAlignJustify size={16} /></ToolBtn>
      </ToolGroup>
    </div>
  );
}

// ── Internal primitives ─────────────────────────────────────────────

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="rich-text-field__Toolbar_Group">{children}</div>;
}

function ToolBtn({
  title,
  active,
  onClick,
  disabled,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={
        "rich-text-field__Toolbar_Btn" +
        (active ? " rich-text-field__Toolbar_Btn--active" : "")
      }
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
