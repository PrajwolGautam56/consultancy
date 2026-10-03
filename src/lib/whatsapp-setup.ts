export type SubscriptionAccountResult = {
  accountId: string;
  roles: Array<"phone" | "template">;
  phoneVerified: boolean;
  subscriptionAccepted: boolean;
  subscribedApps: Array<{ id: string; name: string; overrideCallbackUri?: string }>;
  error?: string;
  warning?: string;
};

type SubscriptionOperations = {
  listPhoneIds: (accountId: string) => Promise<string[]>;
  subscribe: (accountId: string) => Promise<boolean>;
  listApps: (accountId: string) => Promise<SubscriptionAccountResult["subscribedApps"]>;
  safeError: (error: unknown) => string;
};

export async function subscribeVerifiedWhatsAppAccounts(
  phoneAccountId: string,
  templateAccountId: string,
  phoneId: string,
  operations: SubscriptionOperations,
) {
  const accounts: SubscriptionAccountResult[] = [{
    accountId: phoneAccountId, roles: ["phone"], phoneVerified: false,
    subscriptionAccepted: false, subscribedApps: [],
  }];
  if (templateAccountId === phoneAccountId) accounts[0].roles.push("template");
  else accounts.push({
    accountId: templateAccountId, roles: ["template"], phoneVerified: false,
    subscriptionAccepted: false, subscribedApps: [],
  });

  // Complete every ownership check before writing either subscription.
  await Promise.all(accounts.map(async (account) => {
    try {
      account.phoneVerified = (await operations.listPhoneIds(account.accountId)).includes(phoneId);
      if (!account.phoneVerified) account.error = "Configured phone ID is not present in this WhatsApp account.";
    } catch (error) { account.error = operations.safeError(error); }
  }));
  if (accounts.some((account) => !account.phoneVerified)) {
    return { success: false, preflightFailed: true, accounts };
  }

  for (const account of accounts) {
    try {
      if (!await operations.subscribe(account.accountId)) throw new Error("Meta did not confirm the subscription");
      account.subscriptionAccepted = true;
      try { account.subscribedApps = await operations.listApps(account.accountId); }
      catch (error) { account.warning = `Meta accepted the subscription, but its app list could not be refreshed: ${operations.safeError(error)}`; }
    } catch (error) { account.error = operations.safeError(error); }
  }
  return { success: accounts.every((account) => account.subscriptionAccepted), preflightFailed: false, accounts };
}
