"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  REFERRAL_STATUSES,
  ReferralError,
  type ReferralStatus,
  updateReferralManagerWorkflow,
} from "@/lib/referrals";

function toErrorMessage(error: unknown) {
  if (error instanceof ReferralError) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function normalizeStatus(value: string): ReferralStatus {
  if (REFERRAL_STATUSES.includes(value as ReferralStatus)) {
    return value as ReferralStatus;
  }

  return "Pending";
}

export async function adminLoginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  if (password === "##eternalgy8888") {
    (await cookies()).set("admin_access", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24, // 1 day
      path: "/",
    });
    
    redirect("/admin");
  } else {
    redirect("/admin?error=Invalid+password");
  }
}

export async function adminLogoutAction() {
  (await cookies()).delete("admin_access");
  redirect("/admin");
}

export async function adminUpdateReferralWorkflowAction(formData: FormData) {
  try {
    const adminAccess = (await cookies()).get("admin_access")?.value;
    
    if (adminAccess !== "true") {
      throw new ReferralError("Unauthorized. Admin access required.");
    }

    await updateReferralManagerWorkflow({
      referralId: Number(formData.get("referralId") ?? "0"),
      assignedAgentId: String(formData.get("assignedAgentId") ?? ""),
      status: normalizeStatus(String(formData.get("status") ?? "Pending")),
    });

    revalidatePath("/admin");
    redirect("/admin?success=Referral+workflow+updated");
  } catch (error) {
    const message = toErrorMessage(error);
    redirect(`/admin?error=${encodeURIComponent(message)}`);
  }
}
