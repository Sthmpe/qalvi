"use client";

import { useEffect } from "react";

/** Called only after the server has confirmed the resume capability is invalid. */
export default function ClearInterviewDrafts() {
  useEffect(() => {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("qalvi:draft:")) sessionStorage.removeItem(key);
    }
  }, []);
  return null;
}
