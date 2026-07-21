"use client";

import { useEffect } from "react";
import { useEditor } from "@tiptap/react";
import { Fragment, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { parseKnowledgeDocumentMarkdownPaste } from "@/lib/knowledge/knowledge-doc-markdown-paste";
import { normalizeKnowledgeDocumentMarkdown } from "@/lib/knowledge/knowledge-doc-markdown-roundtrip";
import { sectionAnchorId } from "@/lib/knowledge/knowledge-doc-outline";

const extensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
    },
    link: {
      openOnClick: false,
      autolink: true,
    },
  }),
  Markdown,
];

function assignSectionAnchorIds(editor) {
  if (!editor) return;
  const headings = editor.view.dom.querySelectorAll("h2");
  headings.forEach((heading, index) => {
    heading.id = sectionAnchorId(index);
  });
}

export function useKnowledgeDocsEditor({ value, onChange }) {
  const editor = useEditor({
    extensions,
    content: value || "",
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[520px] px-8 py-7 outline-none",
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        const pastedContent = parseKnowledgeDocumentMarkdownPaste(text);
        if (!pastedContent) return false;

        event.preventDefault();
        const nodes = pastedContent.map((node) => view.state.schema.nodeFromJSON(node));
        const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    onCreate({ editor: createdEditor }) {
      assignSectionAnchorIds(createdEditor);
    },
    onUpdate({ editor: updatedEditor }) {
      onChange?.(normalizeKnowledgeDocumentMarkdown(updatedEditor.getMarkdown()));
      assignSectionAnchorIds(updatedEditor);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = String(value || "");
    if (normalizeKnowledgeDocumentMarkdown(editor.getMarkdown()) === next) return;
    editor.commands.setContent(next, {
      contentType: "markdown",
      emitUpdate: false,
    });
    assignSectionAnchorIds(editor);
  }, [editor, value]);

  return { editor };
}
