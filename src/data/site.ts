/** Site-wide identity. Every string here is Viviana's real copy, verbatim. */
export const site = {
  name: 'Viviana Acosta',
  role: 'Latina Technologist and Creator',
  taglineA: 'Engineer on the outside. Writer and artist within.',
  taglineB: 'American. Immigrant',
  /** Home hero wording (hers, exact): seen and safe */
  missionHero: 'Inspiring children of all ages to feel seen and safe',
  /** Footer wording (hers, exact): safe and seen */
  missionFooter: 'Inspiring children of all ages to feel safe and seen',
  description:
    'Viviana Acosta writes science and speculative fiction and people of color, multicultural narratives, especially the immigrant diaspora. Engineer on the outside. Writer and artist within.',
  email: 'escritoraviviana@gmail.com',
  newsletterPrompt: 'Sign up with your email address to receive news and updates.',
  socials: [
    {
      label: 'Email',
      href: 'mailto:escritoraviviana@gmail.com',
      platform: 'email',
    },
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/escritoraviv',
      platform: 'instagram',
    },
    {
      label: 'Bluesky',
      href: 'https://bsky.app/profile/escritoraviv.bsky.social',
      platform: 'bluesky',
    },
  ],
  nav: [
    { label: 'About', href: '/about/' },
    { label: 'Writing', href: '/writing/' },
    { label: 'Causes', href: '/causes/' },
    { label: 'Contact', href: '/contact/' },
    { label: 'Blog', href: '/blog/' },
  ],
  writingNav: [
    { label: 'Picture Books', href: '/writing/picture-books/' },
    { label: 'Short Fiction', href: '/writing/short-fiction/' },
    { label: 'Young Adult Novel', href: '/writing/ascension/' },
  ],
} as const;
