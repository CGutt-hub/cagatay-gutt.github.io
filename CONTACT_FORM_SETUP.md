# Contact Form Setup

The website now uses a contact form instead of displaying email addresses directly. This is more professional and helps protect against spam.

## Current Setup

The contact form uses [Web3Forms](https://web3forms.com/) - a free, privacy-focused form backend service that works perfectly with static sites like GitHub Pages.

## How to Configure

To make the contact form functional, you need to get a free access key from Web3Forms:

### Step 1: Get Your Access Key

1. Go to [Web3Forms](https://web3forms.com/)
2. Enter your email address (this is where form submissions will be sent)
3. Click "Get Started Free"
4. You'll receive an access key via email

### Step 2: Update the Form

1. Open `content/_index.md`
2. Find the line: `<input type="hidden" name="access_key" value="REPLACE_WITH_YOUR_WEB3FORMS_KEY">`
3. Replace `REPLACE_WITH_YOUR_WEB3FORMS_KEY` with your actual access key
4. Commit and push the changes

### Alternative: Use a Different Form Service

If you prefer a different service, you can easily modify the form:

**Formspree:**
- Sign up at [formspree.io](https://formspree.io/)
- Change the form action to: `https://formspree.io/f/YOUR_FORM_ID`

**Netlify Forms (if hosting on Netlify):**
- Add `data-netlify="true"` attribute to the `<form>` tag
- No external service needed

**Custom Backend:**
- Point the form action to your own API endpoint

## Testing the Form

After configuring your access key:

1. Build and deploy the site
2. Fill out the form on your live site
3. Submit a test message
4. Check your email for the submission

## Security Features

The form includes:
- Hidden honeypot field (`botcheck`) to prevent spam bots
- Required field validation
- Email format validation
- Redirect after submission to improve user experience

## Privacy

Web3Forms is GDPR compliant and doesn't store form submissions on their servers - they're forwarded directly to your email. This ensures visitor privacy while providing you with a functional contact form.
