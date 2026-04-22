"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentAuthUser } from "@/lib/auth";
import { findInternalAppUser, hasAnyAccessLevel } from "@/lib/internal-users";
import {
  PROJECT_TYPE_OPTIONS,
  REFERRAL_STATUSES,
  RELATIONSHIP_OPTIONS,
  ReferralError,
  type ProjectTypeOption,
  type RelationshipOption,
  type ReferralStatus,
  createReferral,
  findOrCreateReferrerAccount,
  updateReferral,
  updateReferralManagerWorkflow,
  updateReferrerProfile,
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

function normalizeProjectType(value: string): ProjectTypeOption {
  if (PROJECT_TYPE_OPTIONS.includes(value as ProjectTypeOption)) {
    return value as ProjectTypeOption;
  }

  return "OTHERS";
}

function normalizeStatus(value: string): ReferralStatus {
  if (REFERRAL_STATUSES.includes(value as ReferralStatus)) {
    return value as ReferralStatus;
  }

  return "Pending";
}

async function getActionAuthUser() {
  const user = await getCurrentAuthUser();

  if (!user) {
    redirect("/auth/start?return_to=/dashboard");
  }

  return user;
}

async function getActionReferrer() {
  return findOrCreateReferrerAccount(await getActionAuthUser());
}

async function requireManagerUser() {
  const authUser = await getActionAuthUser();
  const internalUser = await findInternalAppUser(authUser);

  if (!internalUser || !hasAnyAccessLevel(internalUser.accessLevels, ["HR", "KC"])) {
    throw new ReferralError("Only HR/KC users can manage referral assignments.");
  }

  return internalUser;
}

export async function addReferralAction(formData: FormData) {
  try {
    const referrer = await getActionReferrer();
    const relationship = normalizeRelationship(String(formData.get("relationship") ?? ""));
    const projectType = normalizeProjectType(String(formData.get("projectType") ?? ""));

    await createReferral(referrer, {
      leadName: String(formData.get("leadName") ?? ""),
      leadMobileNumber: String(formData.get("leadMobileNumber") ?? ""),
      leadState: String(formData.get("leadState") ?? formData.get("livingRegion") ?? ""),
      leadCity: String(formData.get("leadCity") ?? ""),
      leadAddress: String(formData.get("leadAddress") ?? ""),
      relationship,
      projectType,
      preferredAgentId: String(formData.get("preferredAgentId") ?? ""),
      remark: String(formData.get("remark") ?? ""),
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
    const projectType = normalizeProjectType(String(formData.get("projectType") ?? ""));

    await updateReferral(referrer, {
      referralId: Number(formData.get("referralId") ?? "0"),
      leadName: String(formData.get("leadName") ?? ""),
      leadMobileNumber: String(formData.get("leadMobileNumber") ?? ""),
      leadState: String(formData.get("leadState") ?? formData.get("livingRegion") ?? ""),
      leadCity: String(formData.get("leadCity") ?? ""),
      leadAddress: String(formData.get("leadAddress") ?? ""),
      relationship,
      projectType,
      preferredAgentId: String(formData.get("preferredAgentId") ?? ""),
    });

    revalidatePath("/dashboard");
    redirect("/dashboard?success=Referral+updated");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
}

export async function updateReferralWorkflowAction(formData: FormData) {
  try {
    await requireManagerUser();

    await updateReferralManagerWorkflow({
      referralId: Number(formData.get("referralId") ?? "0"),
      assignedAgentId: String(formData.get("assignedAgentId") ?? ""),
      status: normalizeStatus(String(formData.get("status") ?? "Pending")),
    });

    revalidatePath("/dashboard");
    redirect("/dashboard?success=Referral+workflow+updated");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
}
