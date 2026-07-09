import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { api, uploadFile } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { AdminSearchBar, StatusBadge } from './AdminUi';
import { cn } from '@/lib/utils';

export type BannerAd = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  description: string | null;
  placement: 'feed' | 'sidebar';
  user_id: string;
  business_id: string;
  business_name?: string;
  user_name?: string;
  is_active: boolean;
  order_num: number;
  end_date: string | null;
  is_expired?: boolean;
};

type AdminUser = { id: string; full_name: string; username: string; email: string };
type AdminBusiness = { id: string; name: string; owner_id: string; owner_name: string };

type FormState = {
  placement: 'feed' | 'sidebar';
  image_url: string;
  description: string;
  user_id: string;
  userQuery: string;
  business_id: string;
  end_date: string;
  order_num: number;
};

const emptyForm = (placement: 'feed' | 'sidebar' = 'feed'): FormState => ({
  placement,
  image_url: '',
  description: '',
  user_id: '',
  userQuery: '',
  business_id: '',
  end_date: '',
  order_num: 0,
});

function defaultEndDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function adToForm(initial: BannerAd): FormState {
  return {
    placement: initial.placement,
    image_url: initial.image_url,
    description: initial.description || '',
    user_id: initial.user_id,
    userQuery: initial.user_name || '',
    business_id: initial.business_id,
    end_date: initial.end_date?.slice(0, 10) || defaultEndDate(),
    order_num: initial.order_num,
  };
}

function BannerForm({
  initial,
  onDone,
}: {
  initial?: BannerAd | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() =>
    initial ? adToForm(initial) : { ...emptyForm(), end_date: defaultEndDate() }
  );
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm(adToForm(initial));
    } else {
      setForm({ ...emptyForm(), end_date: defaultEndDate() });
    }
  }, [initial?.id]);

  const { data: userResults = [] } = useQuery({
    queryKey: ['admin-users-banner', form.userQuery],
    queryFn: () => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(form.userQuery)}&status=active`),
    enabled: form.userQuery.trim().length >= 2,
  });

  const { data: businesses = [] } = useQuery({
    queryKey: ['admin-businesses-banner', form.user_id],
    queryFn: () => api<AdminBusiness[]>(`/admin/businesses?owner_id=${form.user_id}&status=active`),
    enabled: !!form.user_id,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        placement: form.placement,
        user_id: form.user_id,
        business_id: form.business_id,
        image_url: form.image_url,
        description: form.description,
        end_date: form.end_date,
        order_num: form.order_num,
        is_active: true,
      };
      if (initial?.id) {
        return api(`/admin/advertisements/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      return api('/admin/advertisements', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-banner-slots'] });
      qc.invalidateQueries({ queryKey: ['admin-ads'] });
      qc.invalidateQueries({ queryKey: ['advertisements'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      onDone();
    },
  });

  const handleImage = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      setForm((f) => ({ ...f, image_url: url }));
    } finally {
      setUploading(false);
    }
  };

  const canSave = !!form.user_id && !!form.business_id && !!form.image_url.trim() && !!form.end_date;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h3 className="font-semibold">{initial ? t('admin.editBanner') : t('admin.newBanner')}</h3>

        <div className="flex gap-2">
          {(['feed', 'sidebar'] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={!!initial}
              onClick={() => setForm((f) => ({ ...f, placement: p }))}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium',
                form.placement === p
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-200 text-slate-600',
                initial && 'opacity-60'
              )}
            >
              {p === 'feed' ? t('admin.bannerFeed') : t('admin.bannerSidebar')}
            </button>
          ))}
        </div>

        <AdminSearchBar
          value={form.userQuery}
          onChange={(v: string) => setForm({ ...form, userQuery: v, user_id: '', business_id: '' })}
          placeholder={t('admin.searchPayingUser')}
        />
        {form.userQuery.trim().length >= 2 && userResults.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200">
            {userResults.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setForm({ ...form, user_id: u.id, userQuery: u.full_name, business_id: '' })}
                className={cn(
                  'flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50',
                  form.user_id === u.id && 'bg-brand-50'
                )}
              >
                <span className="font-medium">{u.full_name}</span>
                <span className="text-xs text-slate-500">@{u.username}</span>
              </button>
            ))}
          </div>
        )}

        {form.user_id && (
          <select
            className="flex h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            value={form.business_id}
            onChange={(e) => setForm({ ...form, business_id: e.target.value })}
          >
            <option value="">{t('admin.selectBusiness')}</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        <Input
          placeholder={t('admin.adDescription')}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Input
          placeholder={t('admin.bannerImageRequired')}
          value={form.image_url}
          onChange={(e) => setForm({ ...form, image_url: e.target.value })}
        />
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600 hover:text-brand-700">
          <ImagePlus className="h-4 w-4" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])} />
          {uploading ? t('common.loading') : t('admin.uploadImage')}
        </label>
        <p className="text-xs font-medium text-slate-600">{t('admin.bannerEndDate')}</p>
        <Input
          type="date"
          value={form.end_date}
          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">{t('admin.bannerOrder')}</p>
          <p className="text-xs text-slate-500">{t('admin.bannerOrderHint')}</p>
          <Input
            type="number"
            min={0}
            value={form.order_num}
            onChange={(e) => setForm({ ...form, order_num: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {t('admin.saveBanner')}
          </Button>
          <Button variant="outline" onClick={onDone}>{t('common.cancel')}</Button>
        </div>
        <p className="text-xs text-slate-500">{t('admin.bannerBusinessLimitHint')}</p>
      </CardContent>
    </Card>
  );
}

function BannerList({
  placement,
  items,
  editingId,
  onEdit,
}: {
  placement: 'feed' | 'sidebar';
  items: BannerAd[];
  editingId: string | null;
  onEdit: (ad: BannerAd) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api(`/admin/advertisements/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-banner-slots'] });
      qc.invalidateQueries({ queryKey: ['advertisements'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/advertisements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-banner-slots'] });
      qc.invalidateQueries({ queryKey: ['advertisements'] });
    },
  });

  const filtered = items.filter((a) => a.placement === placement);

  if (filtered.length === 0) {
    return <p className="text-sm text-slate-500">{t('admin.noBannersInSlot')}</p>;
  }

  return (
    <div className="space-y-2">
      {filtered.map((ad) => (
        <div
          key={ad.id}
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3',
            editingId === ad.id ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200'
          )}
        >
          <img src={ad.image_url} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{ad.business_name || ad.title}</p>
            <p className="text-xs text-slate-500">{ad.user_name} · {t('admin.until')} {ad.end_date?.slice(0, 10) || '—'}</p>
            <StatusBadge active={ad.is_active && !ad.is_expired} activeLabel={t('admin.active')} inactiveLabel={t('admin.inactive')} />
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" onClick={() => onEdit(ad)}><Pencil className="h-3 w-3" /></Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggle.mutate({ id: ad.id, is_active: !(ad.is_active && !ad.is_expired) })}
            >
              {ad.is_active && !ad.is_expired ? t('admin.deactivate') : t('admin.activate')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => remove.mutate(ad.id)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BannerSlotsPanel() {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BannerAd | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-banner-slots'],
    queryFn: () => api<{ feed: BannerAd[]; sidebar: BannerAd[] }>('/admin/advertisements/slots'),
  });

  const all = [...(data?.feed ?? []), ...(data?.sidebar ?? [])];

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (ad: BannerAd) => {
    setEditing(ad);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  if (isLoading) return <p className="py-4 text-center text-slate-500">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('admin.bannersManageHint')}</p>

      {!formOpen && (
        <Button onClick={openCreate}>{t('admin.newBanner')}</Button>
      )}

      {formOpen && (
        <BannerForm
          key={editing?.id ?? 'new-banner'}
          initial={editing}
          onDone={closeForm}
        />
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">{t('admin.bannerFeed')}</h3>
          <BannerList
            placement="feed"
            items={all}
            editingId={editing?.id ?? null}
            onEdit={openEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">{t('admin.bannerSidebar')}</h3>
          <BannerList
            placement="sidebar"
            items={all}
            editingId={editing?.id ?? null}
            onEdit={openEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
