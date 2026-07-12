import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ResizableImageView } from './ResizableImageView';

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
        renderHTML: (attributes) => {
          const width = attributes.width || '100%';
          return {
            width,
            style: `width: ${width}; height: auto; max-width: 100%;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
