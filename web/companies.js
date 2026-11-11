export function companyTags(companies, linkToCatalog = false) {
  const group = document.createElement("div");
  group.className = "tag-group";
  for (const company of companies) {
    const chip = document.createElement(linkToCatalog ? "a" : "span");
    chip.className = "company-tag";
    if (linkToCatalog) chip.href = "/?" + new URLSearchParams({ company: company.id });
    if (company.logo) {
      const logo = document.createElement("img");
      logo.src = company.logo;
      logo.alt = "";
      chip.append(logo);
    }
    chip.append(company.name);
    group.append(chip);
  }
  return group;
}
