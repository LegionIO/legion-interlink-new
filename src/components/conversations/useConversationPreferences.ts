import { useState, useEffect, useMemo, useCallback } from 'react';

export type SortField = 'latest-updated' | 'first-created' | 'alphabetical';
export type SortDirection = 'asc' | 'desc';
export type SortPreference = { field: SortField; direction: SortDirection };

export type FilterPreference = {
  hasToolCalls: boolean | null;
  hasComputerUse: boolean | null;
  messageCountMin: number | null;
  messageCountMax: number | null;
  createdAfter: string | null;
  createdBefore: string | null;
  updatedAfter: string | null;
  updatedBefore: string | null;
};

export const DEFAULT_SORT: SortPreference = { field: 'latest-updated', direction: 'desc' };

export const DEFAULT_FILTER: FilterPreference = {
  hasToolCalls: null,
  hasComputerUse: null,
  messageCountMin: null,
  messageCountMax: null,
  createdAfter: null,
  createdBefore: null,
  updatedAfter: null,
  updatedBefore: null,
};

const SORT_KEY = __BRAND_APP_SLUG + ':conversation-sort';
const FILTER_KEY = __BRAND_APP_SLUG + ':conversation-filter';

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

export function useConversationPreferences() {
  const [sort, setSort] = useState<SortPreference>(() => load(SORT_KEY, DEFAULT_SORT));
  const [filter, setFilter] = useState<FilterPreference>(() => load(FILTER_KEY, DEFAULT_FILTER));

  useEffect(() => {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  }, [sort]);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  }, [filter]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filter.hasToolCalls != null) count++;
    if (filter.hasComputerUse != null) count++;
    if (filter.messageCountMin != null) count++;
    if (filter.messageCountMax != null) count++;
    if (filter.createdAfter) count++;
    if (filter.createdBefore) count++;
    if (filter.updatedAfter) count++;
    if (filter.updatedBefore) count++;
    return count;
  }, [filter]);

  const clearFilters = useCallback(() => setFilter(DEFAULT_FILTER), []);

  const isDefaultSort = sort.field === DEFAULT_SORT.field && sort.direction === DEFAULT_SORT.direction;

  return { sort, setSort, filter, setFilter, activeFilterCount, clearFilters, isDefaultSort };
}
