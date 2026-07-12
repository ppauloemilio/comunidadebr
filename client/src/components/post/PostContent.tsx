import { FormattedText } from '@/lib/formatPostText';
import {
  isRichHtml,
  plainTextFromHtml,
  sanitizePostHtml,
} from '@/lib/postContent';
import {
  normalizePostImages,
  postImageFrameClass,
  postImageImgClass,
  type PostImage,
} from '@/lib/postImages';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  content: string;
  images?: Array<string | PostImage>;
  className?: string;
  collapseLen?: number;
  expanded?: boolean;
  onExpand?: () => void;
  seeMoreLabel?: string;
};

export function PostContent({
  content,
  images,
  className,
  collapseLen = 280,
  expanded = true,
  onExpand,
  seeMoreLabel = 'Ver mais',
}: Props) {
  const rich = isRichHtml(content);
  const legacyImages = normalizePostImages(images);
  const showLegacyImages = !rich && legacyImages.length > 0;

  if (rich) {
    const plain = plainTextFromHtml(content);
    const isLong = plain.length > collapseLen;
    const html = sanitizePostHtml(content);

    return (
      <div className={cn('space-y-2', className)}>
        <div
          className={cn(
            'post-html text-[15px] leading-relaxed text-slate-800',
            !expanded && isLong && 'max-h-40 overflow-hidden'
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isLong && !expanded && onExpand && (
          <button
            type="button"
            className="font-medium text-brand-700 hover:underline"
            onClick={onExpand}
          >
            {seeMoreLabel}
          </button>
        )}
      </div>
    );
  }

  const isLong = content.length > collapseLen;
  const display = expanded || !isLong ? content : `${content.slice(0, collapseLen)}...`;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="text-[15px] leading-relaxed">
        <FormattedText text={display} />
        {isLong && !expanded && onExpand && (
          <button
            type="button"
            className="ml-1 font-medium text-brand-700 hover:underline"
            onClick={onExpand}
          >
            {seeMoreLabel}
          </button>
        )}
      </div>
      {showLegacyImages && (
        <div className="space-y-3">
          {legacyImages.map((img) => (
            <div key={img.url} className={postImageFrameClass(img.size)}>
              <img src={mediaUrl(img.url)} alt="" className={postImageImgClass(img.size)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
