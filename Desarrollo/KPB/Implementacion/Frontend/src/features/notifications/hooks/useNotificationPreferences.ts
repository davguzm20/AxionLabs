import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getUserPreferences,
  updateEmailNotificationPreference,
} from '../services/notificationService';
import type { UserPreferences } from '../types/notification.types';

export const preferencesQueryKey = ['userPreferences'] as const;

export function useNotificationPreferences() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: preferencesQueryKey,
    queryFn: ({ signal }) => getUserPreferences(signal),
  });
  const mutation = useMutation({
    mutationFn: updateEmailNotificationPreference,
    onMutate: async (emailNotifications) => {
      await queryClient.cancelQueries({ queryKey: preferencesQueryKey });
      const previous = queryClient.getQueryData<UserPreferences>(preferencesQueryKey);
      if (previous) {
        queryClient.setQueryData<UserPreferences>(preferencesQueryKey, {
          ...previous,
          email_notifications: emailNotifications,
        });
      }
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(preferencesQueryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: preferencesQueryKey }),
  });

  return {
    preferences: query.data,
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    saveEmailNotifications: mutation.mutate,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}
