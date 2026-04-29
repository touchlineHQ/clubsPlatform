export interface ClubAddress {
  line1: string;
  line2: string;
  postcode: string;
}

export interface ClubSocials {
  facebook: string;
  instagram: string;
  twitter: string;
}

export interface AboutItem {
  icon: string;
  title: string;
  text: string;
}

export interface NavItem {
  to: string;
  label: string;
  icon: string;
}

export interface MatchdayBadge {
  label: string;
  color: string;
}

export interface ClubEntry {
  id: string;
  slug: string;
  name: string;
  badge?: string;
  primaryColor?: string | null;
}

export interface Club {
  slug: string;
  name: string;
  tagShort?: string;
  tagline: string;
  founded: number;
  email: string;
  address: ClubAddress;
  what3words: string;
  socials: ClubSocials;
  badge?: string;
  primaryColor?: string;
  colours?: string;
  kitDescription?: string;
  clubFeedSlug?: string;
  teamSlugPrefix?: string;
  homeBanner?: string;
  groundImage?: string;
  groundImageAlt?: string;
  matchdayBadges?: MatchdayBadge[];
  nav?: NavItem[];
  about: AboutItem[];
  history: string[];
}

export interface Team {
  name: string;
  description: string;
  photo?: string;
  manager: string;
  coach: string;
  contact: string;
  managerLabel?: string;
  coachLabel?: string;
  slug?: string;    // live feed slug for linking to fixtures/results
  sidebar?: boolean; // show next fixture in sidebar
}

export interface TeamSection {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  logo?: string;
  teams: Team[];
}

export interface TeamsData {
  sections: TeamSection[];
}

export interface CommitteeMember {
  role: string;
  name: string;
  contact: string;
}

export interface CommitteeData {
  committee: CommitteeMember[];
}

export interface RegistrationItem {
  icon: string;
  title: string;
  description: string;
  link: string;
  buttonText: string;
}

export interface NewsItem {
  title: string;
  text: string;
  body?: string;
  link: string;
  linkText: string;
  sections?: string[]; // if absent or empty, shown for all section filters
}

export interface GalleryItem {
  src?: string;
  caption: string;
}

export interface MatchdayItem {
  icon: string;
  title: string;
  text: string;
}

export interface LiveFixture {
  id: string;
  date: string;
  time: string;
  home_team: string;
  away_team: string;
  venue: string;
  division: string;
  league: string;
  team: string;
  home_away: 'home' | 'away';
  opponent: string;
}

export interface LiveResult extends LiveFixture {
  home_score: number | null;
  away_score: number | null;
  goals_for: number | null;
  goals_against: number | null;
}

export interface ClubFeed {
  club: string;
  generated: string;
  fixtures: LiveFixture[];
  results: LiveResult[];
}

export interface LiveTeam {
  name: string;
  slug: string;
  league: string;
}

export interface AppData {
  club: Club;
  teams: TeamsData;
  committee: CommitteeData;
  registration: RegistrationItem[];
  news: NewsItem[];
  gallery: GalleryItem[];
  matchday: MatchdayItem[];
  clubFeed: ClubFeed | null;
  liveTeams: LiveTeam[];
  sidebarFeeds: { feed: TeamFeed; label: string; sectionId: string }[];
}

export interface UserTeamRole {
  id: string;
  teamSlug: string;
  teamLeague: string;
  teamName: string;
  role: 'coach' | 'manager' | 'subscriber';
}

export interface TeamContact {
  id: string;
  name: string;
  email: string;
  role: 'coach' | 'manager';
}

export interface TeamRoleAssignment extends UserTeamRole {
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: number;
}

export interface TeamFeed {
  team: string;
  league: string;
  generated: string;
  fixtures: Omit<LiveFixture, 'team' | 'home_away' | 'opponent'>[];
  results: Omit<LiveResult, 'team' | 'home_away' | 'opponent' | 'goals_for' | 'goals_against'>[];
}
