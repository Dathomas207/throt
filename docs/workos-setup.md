# Turning on sign-in with emailed codes (WorkOS)

Trot signs people in with a 6 digit code sent to their email. WorkOS sends the email and checks the code. Trot then issues its own sign-in token, the same way on the website and in the iPhone app. There is no password, no redirect page and no cookie.

Until the two settings below are in Render, Trot keeps the old trial sign-in (a name and an email, no proof). Adding them switches every device to codes on the next deploy.

## What you need

- A WorkOS account. AuthKit is free for the first 1 million monthly active users.
- Access to the trot-app service on Render.

Nothing else. This design needs no redirect address and no cookie password.

## Steps

1. Create an account at https://workos.com/sign-up.
2. In the WorkOS dashboard, pick the **Staging** environment for the first test. Staging is free and is fine for you and a few friends. Switch to Production when you invite people you do not know.
3. Under **Authentication**, turn on **Magic Auth**. Leave the other methods as they are; Trot does not use them yet. Dashboard labels change from time to time, so if you cannot find it, search the WorkOS docs for "Magic Auth".
4. Go to **API Keys**. Copy the **API key** (starts with `sk_`) and the **Client ID** (starts with `client_`).
5. In Render, open the **trot-app** service, then **Environment**, then **Add Environment Variable**. Add:
   - `WORKOS_API_KEY`: the API key from step 4.
   - `WORKOS_CLIENT_ID`: the Client ID from step 4.
6. Save. Render redeploys the service. This takes about a minute.

Paste the API key only into Render. Do not put it in chat, email, the code or the iPhone app.

## What happens on the next deploy

- Every device that was signed in the old way is signed out the next time it talks to the server. The app says "Sign-in got more secure. Enter your email to get a code." and opens on Sign back in. This is on purpose: someone may hold an old sign-in for another person's email.
- Accounts are matched by email. Signing in with a code to the same email keeps every dog, walk, route, photo and friend.
- New people sign up with their name, email and the code.

## How to test it

1. Open https://trot-app.onrender.com and choose **I already have a page. Sign back in.**
2. Enter your email and tap **Email me a code**.
3. The email comes from WorkOS (its own sending address, unless you set up a custom email domain in WorkOS). Check spam the first time.
4. Type the code. You should land on your dog's page with everything intact.
5. Optional: try a wrong code, and try **Resend the code** after the 30 second wait.

If the code never arrives, or the app says "Sign-in is unavailable right now", check in WorkOS that Magic Auth is on, and in Render that both values are set with no spaces.

## Turning it off

Delete `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` from the trot-app service in Render. After the redeploy, sign-in goes back to name and email. Sessions made with a code keep working.

## Account deletion

Settings has **Delete my account** at the bottom. With codes on, it emails a fresh code and asks for it before deleting. With codes off, the person types their email. Either way it deletes the account, the dogs only that person owns, and their own data, then removes the WorkOS user. A dog with another owner or a family member stays with them. The full rule is at the top of `server/deleteAccount.js`.

## Limits and abuse protection

- Codes asked for: 5 per email and 20 per network address in 15 minutes.
- Codes tried: 8 per email and 40 per network address in 15 minutes.
- A code expires after 10 minutes (set by WorkOS).
- "Email me a code" answers the same way whether or not the email has an account, so the form cannot be used to find out who uses Trot.
- The server never logs or stores a code, an email next to a code, the API key, or WorkOS's own tokens.

## For developers

- The switch: `workosConfig()` in `server/routesAuth.js`. On only when both variables are set.
- `WORKOS_API_BASE` exists for tests only. It points the server at a fake WorkOS. Leave it unset in Render.
- Routes: `GET /api/auth/config`, `POST /api/auth/start`, `POST /api/auth/verify`, `POST /api/auth/complete`, `POST /api/me/delete`. `POST /api/session` (the old sign-in) answers 403 while codes are on.
- Tests: `server/auth.test.js` with a fake WorkOS. The browser check used during development is not in the repo.
- Not yet verified against the real WorkOS API: whether Magic Auth creates a WorkOS user on first use (the server creates one and retries if WorkOS says the user does not exist), the exact error names WorkOS returns (the server matches on status and loose wording, not exact names), and the user delete call. The first real sign-in after adding the keys is the test.
