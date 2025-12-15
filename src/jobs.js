const cron = require("node-cron");
const FacebookUser = require("./models/FacebookUser");
const FacebookLeadDataHandler = require("./handler/FacebookLeadDataHandler");
const { default: axios } = require("axios");
const FacebookLead = require("./models/FacebookLead");
const { subscribeLeadsWebhook } = require("./services/facebook.service");

const downloadLeads = async () => {
  const connectedAccounts = await FacebookUser.find();
  console.log({
    connectedAccounts
  })
  for (const account of connectedAccounts) {
    for (const page of account.pages) {
      await fetchPageLeads(page);
    }
  }
}


/**
 * Fetch leads for a single Facebook Page
 */
async function fetchPageLeads(page) {
  try {
    // 1️⃣ Get lead forms for page
    const formsRes = await axios.get(
      `https://graph.facebook.com/v18.0/${page.page_id}/leadgen_forms`,
      { params: { access_token: page.access_token } }
    );

    const forms = formsRes.data.data || [];

    for (const form of forms) {
      await fetchFormLeads(form.id, page);
    }
  } catch (err) {
    console.error(`❌ Error fetching forms for page ${page.page_id}:`,
      err.response?.data || err.message
    );
  }
}

/**
 * Fetch leads for a form
 */
async function fetchFormLeads(formId, page) {
  try {
    const leadsRes = await axios.get(
      `https://graph.facebook.com/v18.0/${formId}/leads`,
      {
        params: {
          access_token: page.access_token,
          fields:
            "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,created_time,field_data,form_id,platform",
        },
      }
    );

    const leads = leadsRes.data.data || [];

  
    for (const lead of leads) {
      // 2️⃣ Prevent duplicates

      console.log({
        lead: JSON.stringify(lead)
      })
      const exists = await FacebookLead.findOne({ lead_id: lead.id });
      if (exists) continue;
     

      // 3️⃣ Process lead data
      const formRes = await axios.get(
        `https://graph.facebook.com/v18.0/${lead.form_id}`,
        { params: { fields: "name,questions", access_token: page.access_token } }
      )

      const form = formRes.data;
 
      const formName = form.name;
      const questions = form.questions || []
      const facebookLeadHandler = new FacebookLeadDataHandler(lead, questions);

      await FacebookLead.create({
        page_id: page.page_id,
        lead_id: lead.id,
        form_id: lead.form_id,
        created_time: new Date(lead.created_time),
        payload: {
          form_name: formName,
          form_id: facebookLeadHandler.getFormId(),
          phone_number: facebookLeadHandler.getPhone(),
          email: facebookLeadHandler.getEmail(),
          name: facebookLeadHandler.getName(),
          questions: questions,
          data: lead,
        },
      });


    }
  } catch (err) {
    console.error(`❌ Error fetching leads for form ${formId}:`,
      err.response?.data || err.message
    );
  }
}


async function refreshUserTokens(user) {
  try {
    console.log(`Refreshing tokens for user: ${user.name}`);

    // 1️⃣ Refresh user token if it's about to expire
    const now = new Date();
    const expiry = new Date(user.updatedAt.getTime() + user.expires_in * 1000);
    if (true) { // refresh if less than 5 days left
      const res = await axios.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        {
          params: {
            grant_type: "fb_exchange_token",
            client_id: process.env.FACEBOOK_APP_ID,
            client_secret: process.env.FACEBOOK_APP_SECRET,
            fb_exchange_token: user.user_access_token,
          },
        }
      );

      console.log(`User token refreshed response for ${user.name}:`, res.data);
      user.user_access_token = res.data.access_token;
      user.expires_in = 7776000;
      user.updatedAt = new Date();
      await user.save();

      console.log(`User token refreshed for ${user.name}`);
    }

    // 2️⃣ Refresh page tokens
    const pagesRes = await axios.get(
      "https://graph.facebook.com/me/accounts",
      { params: { access_token: user.user_access_token } }
    );

    const pages = pagesRes.data.data || [];
    user.pages = pages.map(page => ({
      page_id: page.id,
      name: page.name,
      category: page.category,
      access_token: page.access_token,
    }));
    await user.save();

    // 3️⃣ Re-subscribe pages to lead webhook (optional, ensures webhook is active)
    for (const page of pages) {
      await subscribeLeadsWebhook(page.access_token);
    }

    console.log(`Page tokens refreshed for ${user.name}`);
  } catch (err) {
    console.error(`Failed to refresh tokens for ${user.name}:`, err.response?.data || err.message);
  }
}


const refreshFacebookTokens = async() => {
console.log("Starting Facebook token refresh job...");
  try {
    const users = await FacebookUser.find({});
    for (const user of users) {
      await refreshUserTokens(user);
    }
    console.log("Facebook token refresh job completed.");
  } catch (err) {
    console.error("Error fetching users for token refresh:", err.message);
  }
}

/**
 * Cron job to refresh all Facebook users
 * Runs every day at 2:00 AM
 */

cron.schedule("0 2 * * *", refreshFacebookTokens);
cron.schedule("* * * * *", downloadLeads);

module.exports = {
  downloadLeads,
};