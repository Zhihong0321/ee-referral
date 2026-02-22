export const COMPANY_LEGAL_NAME = "Eternalgy Sdn Bhd";
export const REFERRAL_FEE_RATE = "2%";

export const REFERRAL_TERMS = [
  {
    title: "Program Scope",
    items: [
      `${COMPANY_LEGAL_NAME} operates this referral program to reward approved external referrals for successful projects.`,
      `The standard referral fee is ${REFERRAL_FEE_RATE} of the final project total amount that is fully paid and not cancelled.`,
    ],
  },
  {
    title: "Referrer Responsibilities",
    items: [
      "Referrer must sign in using WhatsApp and keep profile and bank details accurate.",
      "Referrer confirms they have permission to share the referred lead contact details.",
      "Referrer must provide truthful lead information and must not submit duplicate, fake, or unauthorized leads.",
    ],
  },
  {
    title: "Lead Qualification",
    items: [
      "A lead is only eligible when accepted by the company and converted into a valid project.",
      "Leads already in company records or sourced through other internal channels may be rejected for referral fee eligibility.",
    ],
  },
  {
    title: "Referral Fee and Payment",
    items: [
      `Referral fee calculation is based on ${REFERRAL_FEE_RATE} of the project total amount after validation and internal approval.`,
      "Payment timing and method are determined by company finance procedures and may require complete supporting information.",
      "Any tax obligations related to referral income remain the referrer's responsibility unless required otherwise by law.",
    ],
  },
  {
    title: "Revision, Dispute, and Cancellation",
    items: [
      `${COMPANY_LEGAL_NAME} reserves the right to revise, withhold, offset, or cancel referral fees in the event of project cancellation, pricing adjustment, payment default, duplicate claim, dispute, fraud concern, compliance issue, or any material inaccuracy in referral submission.`,
      "All company decisions on referral fee eligibility and final payable amount are final after internal review.",
    ],
  },
  {
    title: "General",
    items: [
      `${COMPANY_LEGAL_NAME} may update these Terms and Conditions at any time, and updated terms apply once published in the referral portal.`,
      "Participation in the referral program constitutes acceptance of these Terms and Conditions.",
    ],
  },
] as const;
