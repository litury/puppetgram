// Only export constants - components must import server/client functions directly
// Server components: import { getI18n } from '@/locales/server'
// Client components: import { useI18n, useCurrentLocale } from '@/locales/client'

export const locales = ['ru', 'en'] as const
export const defaultLocale = 'ru' as const
