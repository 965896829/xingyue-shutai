"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../ui";
export function useAction() {
  const toast = useToast(),
    cache = useQueryClient();
  return async (fn: () => Promise<unknown>, message?: string) => {
    try {
      const result = await fn();
      await cache.invalidateQueries();
      if (message) toast(message);
      return result;
    } catch (e) {
      toast((e as Error).message, true);
      throw e;
    }
  };
}
