import CodeBlock, { CodeBlockOptions } from "@tiptap/extension-code-block";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { SugarPlugin } from "./sugar-plugin";

type CodeBlockAttrs = {
  node: {
    attrs: {
      language: string;
    };
  };
  updateAttributes: (attrs: { language: string }) => void;
};
export const CodeBlockComp = ({
  node: {
    attrs: { language: defaultLanguage = "typescript" },
  },
}: CodeBlockAttrs) => (
  <NodeViewWrapper className="code-block">
    <pre>
      <NodeViewContent as="code" />
    </pre>
  </NodeViewWrapper>
);

export const CodeBlockSugarHigh = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      SugarPlugin({
        name: this.name,
      }),
    ];
  },
});
