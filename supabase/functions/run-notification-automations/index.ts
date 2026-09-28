// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handleRunNotificationAutomations } from "../_shared/automation-runner.ts";

serve(handleRunNotificationAutomations);
