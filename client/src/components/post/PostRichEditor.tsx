import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link2,
  List, ListOrdered, Heading2, Quote, ImagePlus, Code,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
} from 'lucide-react';
import { uploadFile } from '@/lib/api';
import { toEditorHtml } from '@/lib/postContent';
import { ResizableImage } from './ResizableImage';
import { cn } from '@/lib/utils';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeightClass?: string;
};

type AlignValue = 'left' | 'center' | 'right' | 'justify';

async function uploadAndInsert(editor: Editor, file: File) {
  const { url } = await uploadFile(file);
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'resizableImage',
      attrs: { src: url, width: '70%', align: 'center' },
    })
    .run();
}

function setContentAlignment(editor: Editor, align: AlignValue) {
  if (editor.isActive('resizableImage')) {
    if (align === 'justify') return;
    editor.chain().focus().updateAttributes('resizableImage', { align }).run();
    return;
  }
  editor.chain().focus().setTextAlign(align).run();
}

function isAlignActive(editor: Editor, align: AlignValue) {
  if (editor.isActive('resizableImage')) {
    return editor.getAttributes('resizableImage').align === align;
  }
  return editor.isActive({ textAlign: align });
}

export function PostRichEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeightClass = 'min-h-[180px]',
}: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const lastEmitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-brand-700 underline font-medium',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || t('post.placeholder'),
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      ResizableImage.configure({
        inline: false,
        allowBase64: true,
      }),
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          'prose-post outline-none px-3 py-3 text-sm leading-relaxed text-slate-800',
          minHeightClass
        ),
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items || !editorRef.current || uploadingRef.current) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              uploadingRef.current = true;
              void uploadAndInsert(editorRef.current, file).finally(() => {
                uploadingRef.current = false;
              });
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length || !editorRef.current || uploadingRef.current) return false;
        const file = Array.from(files).find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        event.preventDefault();
        uploadingRef.current = true;
        void uploadAndInsert(editorRef.current, file).finally(() => {
          uploadingRef.current = false;
        });
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const incoming = toEditorHtml(value);
    if (incoming === lastEmitted.current) return;
    if (incoming === editor.getHTML()) return;
    editor.commands.setContent(incoming || '', { emitUpdate: false });
    lastEmitted.current = incoming;
  }, [value, editor]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      active && 'bg-brand-50 text-brand-800'
    );

  const applyLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('post.linkUrl'), prev || 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const onPickImage = async (file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      await uploadAndInsert(editor, file);
    } finally {
      uploadingRef.current = false;
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50/80 px-2 py-1.5">
        <button type="button" className={btn(editor.isActive('bold'))} title={t('post.bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('italic'))} title={t('post.italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('underline'))} title={t('post.underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('strike'))} title={t('post.strikethrough')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('code'))} title={t('post.code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('link'))} title={t('post.link')} onClick={applyLink}>
          <Link2 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className={btn(editor.isActive('heading', { level: 2 }))} title={t('post.heading')} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('blockquote'))} title={t('post.quote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('bulletList'))} title={t('post.bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </button>
        <button type="button" className={btn(editor.isActive('orderedList'))} title={t('post.numberedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className={btn(isAlignActive(editor, 'left'))} title={t('post.alignLeft')} onClick={() => setContentAlignment(editor, 'left')}>
          <AlignLeft className="h-4 w-4" />
        </button>
        <button type="button" className={btn(isAlignActive(editor, 'center'))} title={t('post.alignCenter')} onClick={() => setContentAlignment(editor, 'center')}>
          <AlignCenter className="h-4 w-4" />
        </button>
        <button type="button" className={btn(isAlignActive(editor, 'right'))} title={t('post.alignRight')} onClick={() => setContentAlignment(editor, 'right')}>
          <AlignRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn(isAlignActive(editor, 'justify'))}
          title={t('post.alignJustify')}
          disabled={editor.isActive('resizableImage')}
          onClick={() => setContentAlignment(editor, 'justify')}
        >
          <AlignJustify className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button
          type="button"
          className={btn(false)}
          title={t('post.addPhoto')}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickImage(file);
          }}
        />
      </div>
      <EditorContent editor={editor} />
      <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
        {t('post.richEditorHint')}
      </p>
    </div>
  );
}
