import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export function useList<T>(key: string, endpoint: string) {
  return useQuery<T[]>({
    queryKey: [key],
    queryFn: async () => (await api.get(endpoint)).data,
  });
}

export function useCreate<T, In = Partial<T>>(key: string, endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: In) => (await api.post<T>(endpoint, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

export function useUpdate<T, In = Partial<T>>(key: string, endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: In }) =>
      (await api.patch<T>(`${endpoint}/${id}`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

export function useRemove(key: string, endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}
