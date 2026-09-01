import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/_core/router";

export const trpc = createTRPCReact<AppRouter>();
