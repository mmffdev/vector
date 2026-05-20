"use client";

// RichTextField — TipTap-backed rich text editor with a Rally-style
// toolbar. Designed as a drop-in replacement for any <textarea> that
// wants formatting. Stores its content as TipTap's native JSON doc
// (ProseMirror), which is safer + lossless vs HTML round-trips.
//
// Drop-in usage:
//   <RichTextField
//     value={artefact.description_doc}
//     onChange={(doc) => patch({ description_doc: doc })}
//     placeholder="Add a description…"
//   />
//
// The component is uncontrolled-by-default: the editor owns the live
// state, onChange fires on every doc change. Pass `value` if you need
// to externally reset the doc (e.g. when the parent loads a different
// artefact); the editor will re-sync if `value` changes identity.

import React, { useEffect } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
// NOTE: TipTap v3 StarterKit bundles Bold, Italic, Underline, Strike,
// Code, CodeBlock, Heading, Paragraph, BulletList, OrderedList,
// ListItem, HorizontalRule, Blockquote, HardBreak AND Link. Do NOT
// re-register any of those as standalone extensions — duplicates
// silently break the command chain (toolbar buttons go inert).
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import FontFamily from "@tiptap/extension-font-family";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { RichTextToolbar } from "./RichTextToolbar";

export interface RichTextFieldProps {
  // TipTap JSON doc. Pass null/undefined to start with an empty editor.
  // When `value` changes identity the editor re-syncs.
  value?: JSONContent | null;
  // Called on every doc change with the new TipTap JSON.
  onChange?: (doc: JSONContent) => void;
  // Called when the editor loses focus. Convenient hook for blur-based
  // auto-save (use editor.getJSON() if you need the latest doc).
  onBlur?: (doc: JSONContent) => void;
  placeholder?: string;
  // Disables editing. Toolbar still renders but every button is
  // greyed out. Use for read-only surfaces (e.g. history view).
  readOnly?: boolean;
}

export function RichTextField({
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly = false,
}: RichTextFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Heading levels we expose via the toolbar dropdown.
        heading: { levels: [1, 2, 3] },
        // Configure the bundled Link extension here (not as a
        // separate registration) so links survive paste and can't be
        // used to smuggle javascript: URLs.
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["http", "https", "mailto"],
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FontFamily,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Type something…" }),
    ],
    content: value ?? "",
    editable: !readOnly,
    // SSR safety: render on the client only; ProseMirror touches the DOM.
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getJSON());
    },
    onBlur: ({ editor: e }) => {
      onBlur?.(e.getJSON());
    },
  });

  // External value resync intentionally NOT wired here. Hosts that
  // need to swap content (e.g. ArtefactInlineForm loading a different
  // artefact) should pass `key={artefactId}` so React fully remounts
  // the editor with fresh initial content.
  //
  // Why no useEffect: the host typically rebuilds `value` from a parent
  // state object on every render, which would create a new object
  // identity each pass and trigger setContent — wiping the user's
  // in-progress edit (bold flash → revert). The mount-via-key pattern
  // sidesteps this entirely.

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div className="rich-text-field">
      <RichTextToolbar editor={editor} disabled={readOnly} />
      <EditorContent editor={editor} className="rich-text-field__Content" />
    </div>
  );
}

export default RichTextField;
