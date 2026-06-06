// src/lib/openBillingPortal.ts
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable, HttpsCallableResult } from "firebase/functions";
import { app } from "../firebase";

type PortalLinkPayload = {
  returnUrl: string;
  locale?: string;
  configuration?: string;
};

type PortalLinkResponse = {
  url?: string;
};

export async function openBillingPortal() {
  const auth = getAuth(app);
  const user = auth.currentUser;

  if (!user) {
    alert("Please sign in first.");
    return;
  }

  const payload: PortalLinkPayload = {
    returnUrl: window.location.origin,
    locale: "auto",
    // If you want to force a specific portal configuration, uncomment this:
    // configuration: "bpc_1SUE1EIImx4dvh9S8SYP0mv1",
  };

  try {
    // Region from your error: us-central1-gto-lite.cloudfunctions.net
    const functions = getFunctions(app, "us-central1");

    // Run Payments with Stripe extension
    const createPortalLink = httpsCallable<PortalLinkPayload, PortalLinkResponse>(
      functions,
      "ext-firestore-stripe-payments-createPortalLink"
    );

    const result: HttpsCallableResult<PortalLinkResponse> = await createPortalLink(payload);
    const data = result.data;

    if (!data || typeof data.url !== "string") {
      console.error("[openBillingPortal] Portal link response missing url:", data);
      alert("Unable to open billing settings. Please try again.");
      return;
    }

    window.location.assign(data.url);
  } catch (error: unknown) {
    // Nicely typed error handling to avoid `any`
    let message = "Unknown error – check the Firebase function logs for details.";
    let code: string | undefined;

    if (typeof error === "object" && error !== null) {
      const maybeError = error as { message?: string; code?: string };
      if (maybeError.message) message = maybeError.message;
      if (maybeError.code) code = maybeError.code;
    }

    console.error("[openBillingPortal] Error calling createPortalLink:", error);
    alert(`Unable to open billing settings: ${code ?? ""} ${message}`.trim());
  }
}
