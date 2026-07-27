import WebChat from "@/components/web-chat";
import { getCurrentAuthUser } from "@/lib/auth";
import { findInternalAppUser } from "@/lib/internal-users";

async function detectStaff() {
  try {
    const authUser = await getCurrentAuthUser();
    if (!authUser) return null;
    return await findInternalAppUser(authUser);
  } catch {
    return null;
  }
}

export default async function WebChatPage() {
  const internalUser = await detectStaff();

  return (
    <WebChat
      detectedStaff={internalUser ? { name: internalUser.agentName || internalUser.name } : null}
    />
  );
}
