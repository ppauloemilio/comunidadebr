import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardContent } from '@/components/ui/Card';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { CoverPositionModal } from '@/components/profile/CoverPositionModal';
import { writeCachedAvatar } from '@/lib/avatarCache';
import {
  prepareAvatarImage, prepareCoverImage, validateImageFile, fileToDataUrl,
} from '@/lib/prepareProfileImage';
import {
  type CoverPosition,
  formatCoverPosition,
  parseCoverPosition,
} from '@/lib/coverPosition';
import {
  SKILL_AREAS, PROFICIENCY_LEVELS, LANGUAGE_OPTIONS, SocialLinks,
} from '@/lib/profileConstants';
import { cn } from '@/lib/utils';
import { LocationCascade } from '@/components/profile/LocationCascade';

type EditTab = 'info' | 'location' | 'skills' | 'social';

const EMPTY_LOC = { stateIso: '', stateCustom: '', citySelect: '', cityCustom: '' };

type MeData = {
  full_name: string;
  username: string;
  avatar_url: string | null;
  profile: {
    bio: string;
    cover_url?: string;
    cover_position?: string;
    current_country: string;
    current_state: string;
    current_city: string;
    origin_state: string;
    origin_city: string;
    primary_skill: string;
    show_city_on_profile: boolean;
    show_whatsapp_on_profile: boolean;
    social_links: SocialLinks;
    languages: string[];
  };
  skills: Array<{ id: string; skill_name: string; proficiency_level: string; years_experience: number }>;
};

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-200')}
      >
        <span className={cn('block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function EditProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, refreshUser, patchUser } = useAuth();
  const [tab, setTab] = useState<EditTab>('info');
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ avatar?: string; cover?: string }>({});
  const [coverEditor, setCoverEditor] = useState<{
    src: string;
    file?: File;
    blobUrl?: string;
    mode: 'upload' | 'reposition';
  } | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [langInput, setLangInput] = useState('');
  const [newSkill, setNewSkill] = useState({ name: '', level: 'intermediate', years: '' });

  const [currentLoc, setCurrentLoc] = useState(EMPTY_LOC);
  const [originLoc, setOriginLoc] = useState(EMPTY_LOC);

  const [form, setForm] = useState({
    full_name: '', username: '', bio: '', avatar_url: '' as string | null, cover_url: '',
    cover_position: '50% 50%',
    current_country: '', current_state: '', current_city: '',
    origin_state: '', origin_city: '',
    primary_skill: '', show_city_on_profile: true, show_whatsapp_on_profile: false,
    social_links: {} as SocialLinks, languages: [] as string[],
  });

  const { data: me, isLoading } = useQuery({
    queryKey: ['me-edit'],
    queryFn: () => api<MeData>('/auth/me'),
  });

  useEffect(() => {
    if (!me) return;
    setForm({
      full_name: me.full_name,
      username: me.username,
      bio: me.profile?.bio || '',
      avatar_url: me.avatar_url,
      cover_url: me.profile?.cover_url || '',
      cover_position: me.profile?.cover_position || '50% 50%',
      current_country: me.profile?.current_country || '',
      current_state: me.profile?.current_state || '',
      current_city: me.profile?.current_city || '',
      origin_state: me.profile?.origin_state || '',
      origin_city: me.profile?.origin_city || '',
      primary_skill: me.profile?.primary_skill || me.skills?.[0]?.skill_name || '',
      show_city_on_profile: me.profile?.show_city_on_profile ?? true,
      show_whatsapp_on_profile: me.profile?.show_whatsapp_on_profile ?? false,
      social_links: me.profile?.social_links || {},
      languages: me.profile?.languages?.length ? me.profile.languages : ['Português'],
    });

    const hydrate = async () => {
      type Resolved = { stateIso: string; stateCustom: string; citySelect: string; cityCustom: string };
      if (me.profile?.current_country && me.profile?.current_state) {
        const r = await api<Resolved>(
          `/geo/resolve?country=${me.profile.current_country}&stateName=${encodeURIComponent(me.profile.current_state)}&cityName=${encodeURIComponent(me.profile.current_city || '')}`
        );
        setCurrentLoc({
          stateIso: r.stateIso,
          stateCustom: r.stateCustom,
          citySelect: r.citySelect || me.profile.current_city || '',
          cityCustom: r.cityCustom,
        });
      } else {
        setCurrentLoc(EMPTY_LOC);
      }

      if (me.profile?.origin_state) {
        const r = await api<Resolved>(
          `/geo/resolve?country=BR&stateName=${encodeURIComponent(me.profile.origin_state)}&cityName=${encodeURIComponent(me.profile.origin_city || '')}`
        );
        setOriginLoc({
          stateIso: r.stateIso,
          stateCustom: r.stateCustom,
          citySelect: r.citySelect || me.profile.origin_city || '',
          cityCustom: r.cityCustom,
        });
      } else {
        setOriginLoc(EMPTY_LOC);
      }
    };
    hydrate();
  }, [me]);

  const saveMutation = useMutation({
    mutationFn: () => api('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        full_name: form.full_name,
        username: form.username,
        bio: form.bio,
        ...(form.avatar_url ? { avatar_url: form.avatar_url } : {}),
        ...(form.cover_url ? { cover_url: form.cover_url, cover_position: form.cover_position } : {}),
        current_country: form.current_country,
        current_state: form.current_state,
        current_city: form.current_city,
        origin_state: form.origin_state,
        origin_city: form.origin_city,
        primary_skill: form.primary_skill,
        show_city_on_profile: form.show_city_on_profile,
        show_whatsapp_on_profile: form.show_whatsapp_on_profile,
        social_links: form.social_links,
        languages: form.languages,
      }),
    }),
    onSuccess: () => {
      refreshUser();
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      qc.invalidateQueries({ queryKey: ['me-edit'] });
      navigate('/profile');
    },
  });

  const saveLocationMutation = useMutation({
    mutationFn: (section: 'current' | 'origin') => api('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(
        section === 'current'
          ? {
              current_country: form.current_country,
              current_state: form.current_state,
              current_city: form.current_city,
              show_city_on_profile: form.show_city_on_profile,
            }
          : { origin_state: form.origin_state, origin_city: form.origin_city }
      ),
    }),
  });

  const addSkillMutation = useMutation({
    mutationFn: () => api('/users/me/skills', {
      method: 'POST',
      body: JSON.stringify({
        skill_name: newSkill.name,
        proficiency_level: newSkill.level,
        years_experience: Number(newSkill.years) || 0,
      }),
    }),
    onSuccess: () => {
      setNewSkill({ name: '', level: 'intermediate', years: '' });
      qc.invalidateQueries({ queryKey: ['me-edit'] });
    },
  });

  const deleteSkillMutation = useMutation({
    mutationFn: (id: string) => api(`/users/me/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-edit'] }),
  });

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const persistPhoto = async (
    field: 'avatar_url' | 'cover_url',
    url: string,
    coverPosition?: string
  ) => {
    const body: Record<string, string> = { [field]: url };
    if (field === 'cover_url' && coverPosition) body.cover_position = coverPosition;

    const updated = await api<{ avatar_url?: string | null; cover_url?: string; cover_position?: string }>(
      '/users/me/profile',
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    );

    const saved =
      field === 'avatar_url'
        ? updated.avatar_url
        : updated.cover_url;

    if (!saved) {
      throw new Error(
        field === 'avatar_url'
          ? 'Servidor não gravou o avatar. Tente uma imagem menor.'
          : 'Servidor não gravou a capa. Tente uma imagem menor.'
      );
    }

    setForm((f) => ({
      ...f,
      [field]: saved,
      ...(field === 'cover_url'
        ? { cover_position: updated.cover_position || coverPosition || f.cover_position }
        : {}),
    }));
    qc.setQueryData<MeData>(['me-edit'], (old) => {
      if (!old) return old;
      if (field === 'avatar_url') return { ...old, avatar_url: saved };
      return {
        ...old,
        profile: {
          ...old.profile,
          cover_url: saved,
          cover_position: updated.cover_position || coverPosition || old.profile.cover_position,
        },
      };
    });
    if (field === 'avatar_url') {
      writeCachedAvatar(user?.id, saved);
      patchUser({ avatar_url: saved });
    }
    void refreshUser();
    qc.invalidateQueries({ queryKey: ['profile', user?.id] });
  };

  const persistCoverPosition = async (position: CoverPosition) => {
    const formatted = formatCoverPosition(position);
    const updated = await api<{ cover_position?: string }>('/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ cover_position: formatted }),
    });
    const saved = updated.cover_position || formatted;
    setForm((f) => ({ ...f, cover_position: saved }));
    qc.setQueryData<MeData>(['me-edit'], (old) => {
      if (!old) return old;
      return { ...old, profile: { ...old.profile, cover_position: saved } };
    });
    qc.invalidateQueries({ queryKey: ['profile', user?.id] });
  };

  const closeCoverEditor = () => {
    if (coverEditor?.blobUrl) {
      URL.revokeObjectURL(coverEditor.blobUrl);
      previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== coverEditor.blobUrl);
    }
    setCoverEditor(null);
    if (coverRef.current) coverRef.current.value = '';
  };

  const handleCoverConfirm = async (position: CoverPosition) => {
    if (!coverEditor) return;
    setCoverSaving(true);
    setUploadError(null);
    try {
      if (coverEditor.mode === 'reposition') {
        await persistCoverPosition(position);
        closeCoverEditor();
        return;
      }

      const file = coverEditor.file;
      if (!file) return;
      setUploading('cover');
      const prepared = await prepareCoverImage(file);
      const url = await fileToDataUrl(prepared);
      await persistPhoto('cover_url', url, formatCoverPosition(position));
      setPreview((p) => {
        const next = { ...p };
        delete next.cover;
        return next;
      });
      closeCoverEditor();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('editProfile.uploadError_failed'));
    } finally {
      setCoverSaving(false);
      setUploading(null);
    }
  };

  const handleUpload = async (file: File, field: 'avatar_url') => {
    const validation = validateImageFile(file);
    if (validation) {
      setUploadError(t(`editProfile.uploadError_${validation}`));
      return;
    }

    const previousUrl = form[field];
    setUploadError(null);
    setUploading('avatar');

    const blobUrl = URL.createObjectURL(file);
    previewUrlsRef.current.push(blobUrl);
    setPreview((p) => ({ ...p, avatar: blobUrl }));

    try {
      const prepared = await prepareAvatarImage(file);
      const url = await fileToDataUrl(prepared);
      await persistPhoto(field, url);
      setPreview((p) => {
        const next = { ...p };
        delete next.avatar;
        return next;
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('editProfile.uploadError_failed'));
      setForm((f) => ({ ...f, [field]: previousUrl }));
      setPreview((p) => {
        const next = { ...p };
        delete next.avatar;
        return next;
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
      previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== blobUrl);
      setUploading(null);
      if (avatarRef.current) avatarRef.current.value = '';
    }
  };

  const handleCoverPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (validation) {
      setUploadError(t(`editProfile.uploadError_${validation}`));
      if (coverRef.current) coverRef.current.value = '';
      return;
    }
    setUploadError(null);
    const blobUrl = URL.createObjectURL(file);
    previewUrlsRef.current.push(blobUrl);
    setCoverEditor({
      src: blobUrl,
      file,
      blobUrl,
      mode: 'upload',
    });
  };

  const handleFilePick = (field: 'avatar_url') => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file, field);
  };

  const tabs: { key: EditTab; label: string }[] = [
    { key: 'info', label: t('editProfile.tabInfo') },
    { key: 'location', label: t('editProfile.tabLocation') },
    { key: 'skills', label: t('editProfile.tabSkills') },
    { key: 'social', label: t('editProfile.tabSocial') },
  ];

  if (isLoading) return <p className="py-12 text-center text-slate-500">{t('common.loading')}</p>;

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <div className="mb-4 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/profile')} className="rounded-full p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">{t('editProfile.title')}</h1>
      </div>

      <ProfileHeader
        coverUrl={preview.cover ?? form.cover_url}
        coverPosition={form.cover_position}
        avatarUrl={preview.avatar ?? form.avatar_url}
        name={form.full_name || me?.full_name || 'U'}
        username={form.username || me?.username}
        editable={{
          onCoverClick: () => coverRef.current?.click(),
          onAvatarClick: () => avatarRef.current?.click(),
          coverLoading: uploading === 'cover' || coverSaving,
          avatarLoading: uploading === 'avatar',
        }}
      />
      <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleCoverPick} />
      <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFilePick('avatar_url')} />
      {form.cover_url && (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() =>
              setCoverEditor({
                src: form.cover_url,
                mode: 'reposition',
              })
            }
          >
            {t('editProfile.repositionCover')}
          </Button>
        </div>
      )}
      {uploadError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</p>
      )}
      <p className="mb-4 text-xs text-slate-500">{t('editProfile.photoHint')}</p>

      {coverEditor && (
        <CoverPositionModal
          imageSrc={coverEditor.src}
          initialPosition={
            coverEditor.mode === 'reposition'
              ? form.cover_position
              : parseCoverPosition('50% 40%')
          }
          confirming={coverSaving}
          onCancel={closeCoverEditor}
          onConfirm={handleCoverConfirm}
        />
      )}

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors',
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="space-y-5 pt-6">
          {tab === 'info' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t('editProfile.username')}</label>
                  <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t('editProfile.displayName')}</label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">{t('profile.bio')}</label>
                <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="min-h-[120px]" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">{t('editProfile.primaryArea')}</label>
                <select
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  value={form.primary_skill}
                  onChange={(e) => setForm({ ...form, primary_skill: e.target.value })}
                >
                  <option value="">{t('editProfile.selectArea')}</option>
                  {SKILL_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">{t('editProfile.languages')}</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.languages.map((lang) => (
                    <span key={lang} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-800">
                      {lang}
                      <button type="button" onClick={() => setForm({ ...form, languages: form.languages.filter((l) => l !== lang) })}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <select
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  value={langInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && !form.languages.includes(v)) setForm({ ...form, languages: [...form.languages, v] });
                    setLangInput('');
                  }}
                >
                  <option value="">{t('editProfile.addLanguage')}</option>
                  {LANGUAGE_OPTIONS.filter((l) => !form.languages.includes(l)).map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {tab === 'location' && (
            <>
              <div className="rounded-xl border border-slate-200 p-4 space-y-4">
                <h3 className="font-semibold">{t('editProfile.whereYouLive')}</h3>
                <LocationCascade
                  country={form.current_country}
                  stateIso={currentLoc.stateIso}
                  stateCustom={currentLoc.stateCustom}
                  citySelect={currentLoc.citySelect}
                  cityCustom={currentLoc.cityCustom}
                  onChange={(patch) => {
                    if (patch.country !== undefined) {
                      setForm((f) => ({
                        ...f,
                        current_country: patch.country!,
                        current_state: '',
                        current_city: '',
                      }));
                    }
                    setCurrentLoc((l) => ({ ...l, ...patch }));
                  }}
                  onResolved={({ state, city }) => setForm((f) => ({ ...f, current_state: state, current_city: city }))}
                />
                <Toggle
                  checked={form.show_city_on_profile}
                  onChange={(v) => setForm({ ...form, show_city_on_profile: v })}
                  label={t('editProfile.showCity')}
                  hint={t('editProfile.showCityHint')}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => saveLocationMutation.mutate('current')} disabled={saveLocationMutation.isPending}>
                    {t('editProfile.saveCurrentLocation')}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-4">
                <h3 className="font-semibold">{t('editProfile.brazilOrigin')}</h3>
                <LocationCascade
                  country="BR"
                  fixedCountry="BR"
                  showCountry={false}
                  stateIso={originLoc.stateIso}
                  stateCustom={originLoc.stateCustom}
                  citySelect={originLoc.citySelect}
                  cityCustom={originLoc.cityCustom}
                  onChange={(patch) => setOriginLoc((l) => ({ ...l, ...patch }))}
                  onResolved={({ state, city }) => setForm((f) => ({ ...f, origin_state: state, origin_city: city }))}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => saveLocationMutation.mutate('origin')} disabled={saveLocationMutation.isPending}>
                    {t('editProfile.saveOrigin')}
                  </Button>
                </div>
              </div>
            </>
          )}

          {tab === 'skills' && (
            <>
              <h3 className="font-semibold">{t('editProfile.mySkills')}</h3>
              <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-3">
                <Input placeholder={t('editProfile.skillName')} value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} className="min-w-[140px] flex-1" />
                <select className="h-10 rounded-lg border border-slate-200 px-2 text-sm" value={newSkill.level} onChange={(e) => setNewSkill({ ...newSkill, level: e.target.value })}>
                  {PROFICIENCY_LEVELS.map((l) => <option key={l.value} value={l.value}>{t(l.labelKey)}</option>)}
                </select>
                <Input placeholder={t('editProfile.years')} value={newSkill.years} onChange={(e) => setNewSkill({ ...newSkill, years: e.target.value })} className="w-20" type="number" />
                <Button size="icon" onClick={() => newSkill.name && addSkillMutation.mutate()}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-2">
                {(me?.skills || []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                    <div>
                      <p className="font-semibold">{s.skill_name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`editProfile.level_${s.proficiency_level}` as 'editProfile.level_intermediate')}</span>
                        <span className="ml-2">{s.years_experience} {t('profile.years')}</span>
                      </p>
                    </div>
                    <button type="button" onClick={() => deleteSkillMutation.mutate(s.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'social' && (
            <>
              <h3 className="font-semibold">{t('editProfile.socialTitle')}</h3>
              {([
                ['instagram', 'https://instagram.com/seu_usuario'],
                ['linkedin', 'https://linkedin.com/in/seu_perfil'],
                ['facebook', 'https://facebook.com/seu_perfil'],
                ['website', 'https://seu-site.com'],
                ['public_email', 'seu@email.com'],
                ['whatsapp', '+1 (999) 999-9999'],
              ] as const).map(([key, placeholder]) => (
                <div key={key}>
                  <label className="mb-1 block text-sm font-medium capitalize">{key === 'public_email' ? t('editProfile.publicEmail') : key === 'website' ? t('editProfile.website') : key.charAt(0).toUpperCase() + key.slice(1)}</label>
                  <Input
                    value={form.social_links[key] || ''}
                    onChange={(e) => setForm({ ...form, social_links: { ...form.social_links, [key]: e.target.value } })}
                    placeholder={placeholder}
                  />
                </div>
              ))}
              <Toggle
                checked={form.show_whatsapp_on_profile}
                onChange={(v) => setForm({ ...form, show_whatsapp_on_profile: v })}
                label={t('editProfile.showWhatsapp')}
                hint={t('editProfile.showWhatsappHint')}
              />
            </>
          )}
        </CardContent>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-3xl justify-end gap-2">
          <Button variant="outline" onClick={() => navigate('/profile')}>{t('common.cancel')}</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {t('editProfile.saveChanges')}
          </Button>
        </div>
      </div>
    </div>
  );
}
