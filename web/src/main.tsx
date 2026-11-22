import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { createAccountsApi } from "./api/accounts-api";
import { apiUrl } from "./api/config";
import { createHttpClient } from "./api/http-client";
import { AccountsPage } from "./features/accounts/AccountsPage";

const accountsApi = createAccountsApi(createHttpClient(apiUrl));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountsPage api={accountsApi} />
  </StrictMode>,
);
