function companyLogo(url) {
  const logo = document.createElement("img");
  logo.src = url;
  logo.alt = "";
  return logo;
}

function companyAvatars(companies) {
  const group = document.createElement("div");
  group.className = "company-group";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "company-avatars";
  trigger.setAttribute("aria-label", "Companies: " + companies.map(({ name }) => name).join(", "));

  const details = document.createElement("div");
  details.className = "company-popover";
  details.popover = "auto";
  details.append(companyTags(companies, true));
  trigger.popoverTargetElement = details;
  group.append(trigger, details);

  let openedByHover = false;
  group.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch" || details.matches(":popover-open")) return;
    details.showPopover({ source: trigger });
    openedByHover = true;
  });
  group.addEventListener("pointerleave", () => {
    if (openedByHover && details.matches(":popover-open")) details.hidePopover();
    openedByHover = false;
  });
  trigger.addEventListener("click", (event) => {
    if (!openedByHover || !details.matches(":popover-open")) return;
    // Keep a hovered list open when the user clicks to interact with it.
    event.preventDefault();
    openedByHover = false;
  });

  const visible = companies.length > 4 ? 3 : companies.length;
  for (const company of companies.slice(0, visible)) {
    const avatar = document.createElement("span");
    avatar.className = "company-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (company.logo) avatar.append(companyLogo(company.logo));
    else avatar.textContent = Array.from(company.name.trim())[0]?.toUpperCase() ?? "";
    trigger.append(avatar);
  }
  if (visible < companies.length) {
    const more = document.createElement("span");
    more.className = "company-avatar company-avatar-more";
    more.textContent = "+" + (companies.length - visible);
    more.setAttribute("aria-hidden", "true");
    trigger.append(more);
  }
  return group;
}

export function companyTags(companies, linkToCatalog = false) {
  if (!linkToCatalog && companies.length > 1) return companyAvatars(companies);

  const group = document.createElement("div");
  group.className = "tag-group";
  for (const company of companies) {
    const chip = document.createElement(linkToCatalog ? "a" : "span");
    chip.className = "company-tag";
    if (linkToCatalog) chip.href = "/?" + new URLSearchParams({ company: company.id });
    if (company.logo) chip.append(companyLogo(company.logo));
    const name = document.createElement("span");
    name.className = "company-name";
    name.textContent = company.name;
    chip.append(name);
    group.append(chip);
  }
  return group;
}
