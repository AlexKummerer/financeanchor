import { z } from 'zod';
import { MAX_BASIS_POINTS, MAX_CENTS } from '../money.js';
import { isIsoDate, isYearMonth } from '../month.js';

export const idSchema = z.uuid();
export const timestampSchema = z.int().nonnegative();

export const centsSchema = z.int().min(-MAX_CENTS).max(MAX_CENTS);
export const nonNegativeCentsSchema = z.int().min(0).max(MAX_CENTS);
export const positiveCentsSchema = z.int().min(1).max(MAX_CENTS);
export const basisPointsSchema = z.int().min(0).max(MAX_BASIS_POINTS);

export const yearMonthSchema = z.string().refine(isYearMonth, { error: 'Monat im Format JJJJ-MM' });
export const isoDateSchema = z.string().refine(isIsoDate, { error: 'Datum im Format JJJJ-MM-TT' });

export const nameSchema = z.string().trim().min(1).max(100);

export const accountKinds = ['checking', 'savings', 'depot', 'other'] as const;
export const accountKindSchema = z.enum(accountKinds);
export type AccountKind = z.infer<typeof accountKindSchema>;

export const recurringKinds = ['fixed', 'saving', 'income'] as const;
export const recurringKindSchema = z.enum(recurringKinds);
export type RecurringKind = z.infer<typeof recurringKindSchema>;

export const intervals = [1, 2, 3, 6, 12] as const;
export const intervalSchema = z.literal(intervals);
export type IntervalMonths = z.infer<typeof intervalSchema>;

export const transactionKinds = ['normal', 'reserve', 'transfer', 'loan_payment'] as const;
export const transactionKindSchema = z.enum(transactionKinds);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

export const sourceTypes = ['recurring_item', 'loan', 'reserve_pot'] as const;
export const sourceTypeSchema = z.enum(sourceTypes);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const systemCategoryKeys = ['reserve', 'transfer', 'loans'] as const;
export const systemCategoryKeySchema = z.enum(systemCategoryKeys);
export type SystemCategoryKey = z.infer<typeof systemCategoryKeySchema>;

export const strategies = ['avalanche', 'snowball'] as const;
export const strategySchema = z.enum(strategies);
export type Strategy = z.infer<typeof strategySchema>;

export const locales = ['de', 'en'] as const;
export const localeSchema = z.enum(locales);
export type Locale = z.infer<typeof localeSchema>;

export const currencies = ['EUR'] as const;
export const currencySchema = z.enum(currencies);
export type Currency = z.infer<typeof currencySchema>;
