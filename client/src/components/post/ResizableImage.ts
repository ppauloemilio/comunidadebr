import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ResizableImageView } from './ResizableImageView';

export type ImageAlign = 'left' | 'center' | 'right';

function alignToMargin(align: ImageAlign | string | null | undefined): string {
  if (align === 'left') return 'margin-left: 0; margin-right: auto;';
  if (align === 'right') return 'margin-left: auto; margin-right: 0;';
  return 'margin-left: auto; margin-right: auto;';
}

export const ResizableImage = Image.extend({
  name: 'resizableImage',

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: '100%',
        parseHTML: (element) =>
          element.getAttribute('width') ||
          (element as HTMLElement).style.width ||
          '100%',
        renderHTML: () => ({}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => {
          const dataAlign = element.getAttribute('data-align');
          if (dataAlign === 'left' || dataAlign === 'center' || dataAlign === 'right') {
            return dataAlign;
          }
          const style = (element as HTMLElement).style;
          const ml = style.marginLeft;
          const mr = style.marginRight;
          if (ml === 'auto' && mr === '0px') return 'right';
          if (ml === '0px' && mr === 'auto') return 'left';
          if (ml === 'auto' && mr === 'auto') return 'center';
          return 'center';
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const width = node.attrs.width || '100%';
    const align = (node.attrs.align as ImageAlign) || 'center';
    const { style: _s, width: _w, align: _a, ...rest } = HTMLAttributes as Record<string, unknown>;
    return [
      'img',
      {
        ...rest,
        width,
        'data-align': align,
        style: `width: ${width}; height: auto; max-width: 100%; display: block; ${alignToMargin(align)}`,
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
