import { getSupabaseBrowserClient } from "@/lib/supabase";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const tagKeys = {
  tags: () => ["tags"],
  tag: (tagId: string) => ["tag", tagId],
};

export function useDeleteTagMutation() {
  const queryClient = useQueryClient();
  const supa = getSupabaseBrowserClient();

  return useMutation(
    async (tagId: string) => {
      const res = await supa.from("blog_tags").delete().eq("id", tagId);

      return res;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(tagKeys.tags());
      },
    }
  );
}

export function useUpdateTagMutation() {
  const queryClient = useQueryClient();
  const supa = getSupabaseBrowserClient();

  return useMutation(
    async (tag: { id: string; name: string; slug: string }) => {
      const res = await supa.from("blog_tags").update(tag).eq("id", tag.id);

      return res;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(tagKeys.tags());
      },
    }
  );
}
