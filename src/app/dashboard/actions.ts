"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentAuthUser } from "@/lib/auth";
import {
  RELATIONSHIP_OPTIONS,
  ReferralError,
  type RelationshipOption,
  createReferral,
  findOrCreateReferrerAccount,
  updateReferrerProfile,
  updateReferral,
} from "@/lib/referrals";

function toErrorMessage(error: unknown) {
  if (error instanceof ReferralError) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function normalizeRelationship(value: string): RelationshipOption {
  if (RELATIONSHIP_OPTIONS.includes(value as RelationshipOption)) {
    return value as RelationshipOption;
  }

  return "Other";
}

async function getActionReferrer() {
  const user = await getCurrentAuthUser();

  if (!user) {
    redirect("/auth/start?return_to=/dashboard");
  }

  return findOrCreateReferrerAccount(user);
}

export async function addReferralAction(formData: FormData) {
  try {
    const referrer = await getActionReferrer();
    const relationship = normalizeRelationship(String(formData.get("relationship") ?? ""));

    await createReferral(referrer, {
      leadName: String(formData.get("leadName") ?? ""),
      leadMobileNumber: String(formData.get("leadMobileNumber") ?? ""),
      livingRegion: String(formData.get("livingRegion") ?? ""),
      relationship,
    });

    revalidatePath("/dashboard");
    redirect("/dashboard?success=Referral+added");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
}

export async function updateProfileAction(formData: FormData) {
  try {
    const referrer = await getActionReferrer();

    await updateReferrerProfile(referrer, {
      displayName: String(formData.get("displayName") ?? ""),
      profilePicture: String(formData.get("profilePicture") ?? ""),
      bankAccount: String(formData.get("bankAccount") ?? ""),
      bankerName: String(formData.get("bankerName") ?? ""),
    });

    revalidatePath("/dashboard");
    redirect("/dashboard?success=Profile+updated");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
}

export async function editReferralAction(formData: FormData) {
  try {
    const referrer = await getActionReferrer();
    const relationship = normalizeRelationship(String(formData.get("relationship") ?? ""));

    await updateReferral(referrer, {
      referralId: Number(formData.get("referralId") ?? "0"),
      leadName: String(formData.get("leadName") ?? ""),
      leadMobileNumber: String(formData.get("leadMobileNumber") ?? ""),
      livingRegion: String(formData.get("livingRegion") ?? ""),
      relationship,
      status: String(formData.get("status") ?? "Pending") as
        | "Pending"
        | "Qualified"
        | "Proposal"
        | "Won"
        | "Lost",
    });

    revalidatePath("/dashboard");
    redirect("/dashboard?success=Referral+updated");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
}
