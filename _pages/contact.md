---
layout: contact
permalink: /contact/
title: contact
description: email is the best way to reach me.
nav: true
nav_order: 5
---

<div class="contact-grid">
  <form class="contact-form" name="contact" method="POST" action="https://formspree.io/f/xkgzebda">
    <div class="form-group">
      <label for="inputName">name</label>
      <input type="text" name="name" class="form-control w-100" id="inputName" placeholder="Your name" required>
    </div>
    <div class="form-group">
      <label for="inputEmail">email</label>
      <input type="email" name="email" class="form-control w-100" id="inputEmail" placeholder="you@example.com" required>
    </div>
    <div class="form-group">
      <label for="inputMessage">message</label>
      <textarea name="message" class="form-control" id="inputMessage" rows="6" placeholder="Write your message..." required></textarea>
    </div>
    <div class="d-none">
      <label>Do not fill this field unless you are a bot: <input name="_gotcha"></label>
    </div>
    <button type="submit" class="btn contact-submit">send message</button>
  </form>

  <aside class="contact-details">
    <h2>direct contact</h2>
    <a class="contact-email" href="mailto:{{ site.data.socials.email }}">{{ site.data.socials.email }}</a>

    <div class="contact-links">
      <a href="https://scholar.google.com/citations?user={{ site.data.socials.scholar_userid }}" aria-label="Google Scholar">
        <i class="ai ai-google-scholar" aria-hidden="true"></i>
      </a>
      <a href="https://github.com/{{ site.data.socials.github_username }}" aria-label="GitHub">
        <i class="fa-brands fa-github" aria-hidden="true"></i>
      </a>
      <a href="https://www.linkedin.com/in/{{ site.data.socials.linkedin_username }}" aria-label="LinkedIn">
        <i class="fa-brands fa-linkedin" aria-hidden="true"></i>
      </a>
    </div>

    {% include visitor_map.liquid %}
  </aside>
</div>
