/**
 * useApi — hook genérico para fetch de dados.
 *
 * Uso:
 *   const { data, loading, error, refetch } = useApi('/services');
 *
 * Recarrega quando `url` muda.
 * Para disparar manualmente, use refetch().
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

export function useApi(url, { skip = false } = {}) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(!skip);
  const [error, setError]   = useState(null);
  const abortRef = useRef(null);

  const run = useCallback(async (path) => {
    if (!path) return;
    setLoad(true);
    setError(null);
    try {
      const d = await api.get(path);
      setData(d);
    } catch (e) {
      setError(e.message || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => {
    if (!skip && url) run(url);
  }, [url, skip, run]);

  const refetch = useCallback(() => run(url), [url, run]);

  return { data, loading, error, refetch, setData };
}

/**
 * useMutation — hook para POST/PATCH/DELETE.
 *
 * Uso:
 *   const { mutate, loading, error } = useMutation();
 *   await mutate(() => api.post('/appointments/walk-in', body));
 */
export function useMutation() {
  const [loading, setLoad] = useState(false);
  const [error, setError]  = useState(null);

  const mutate = useCallback(async (fn) => {
    setLoad(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (e) {
      const msg = e.message || 'Erro na operação';
      setError(msg);
      throw e;
    } finally {
      setLoad(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { mutate, loading, error, clearError };
}
