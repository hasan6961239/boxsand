/**
 * أنواع قاعدة البيانات — مكتوبة يدوياً لتطابق supabase/migrations.
 *
 * كُتبت يدوياً لا بالتوليد، لأن التوليد يتطلب اتصالاً بمشروع Supabase حيّ عند
 * كل بناء، وهو ما يكسر البناء على Netlify. عند تعديل أي هجرة، عدّل هنا أيضاً.
 */

export type AccountRole = 'super_admin' | 'owner';
export type MemberRole = 'owner' | 'manager' | 'staff';
export type RestaurantStatus = 'trial' | 'active' | 'suspended' | 'disabled';
export type ProductBadge = 'new' | 'popular' | 'offer' | 'spicy' | 'vegetarian';
export type ComplaintType = 'complaint' | 'suggestion' | 'note';
export type ComplaintStatus = 'new' | 'in_review' | 'resolved' | 'closed';
export type ThemePreset = 'elegant' | 'modern' | 'luxury' | 'minimal' | 'dark' | 'classic';
export type ButtonStyle = 'solid' | 'soft' | 'outline';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: AccountRole;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  short_id: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  maps_url: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  show_unavailable: boolean;
  show_prices: boolean;
  accept_complaints: boolean;
  status: RestaurantStatus;
  status_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestaurantTheme {
  restaurant_id: string;
  preset: ThemePreset;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
  card_color: string;
  font_family: 'tajawal' | 'cairo' | 'system';
  border_radius: number;
  button_style: ButtonStyle;
  default_dark: boolean;
  updated_at: string;
}

export interface OpeningHour {
  id: string;
  restaurant_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  created_at: string;
}

export interface Category {
  id: string;
  restaurant_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number;
  compare_at_price: number | null;
  badges: ProductBadge[];
  is_available: boolean;
  is_visible: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  restaurant_id: string;
  name: string;
  price: number;
  is_available: boolean;
  position: number;
  created_at: string;
}

export interface OptionGroup {
  id: string;
  product_id: string;
  restaurant_id: string;
  name: string;
  min_select: number;
  max_select: number;
  position: number;
  created_at: string;
}

export interface ProductOption {
  id: string;
  group_id: string;
  restaurant_id: string;
  name: string;
  price_delta: number;
  is_available: boolean;
  position: number;
  created_at: string;
}

export interface Offer {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  badge_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Complaint {
  id: string;
  restaurant_id: string;
  ref_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  type: ComplaintType;
  rating: number | null;
  message: string;
  status: ComplaintStatus;
  is_read: boolean;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_monthly: number | null;
  currency: string;
  max_categories: number | null;
  max_products: number | null;
  features: string[];
  is_public: boolean;
  position: number;
}

export interface Subscription {
  id: string;
  restaurant_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  starts_at: string;
  ends_at: string | null;
  note: string | null;
}

export interface PlatformSettings {
  id: boolean;
  platform_name: string;
  tagline: string;
  logo_url: string | null;
  primary_color: string;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp: string | null;
  social: Record<string, string>;
  seo_title: string | null;
  seo_description: string | null;
  allow_signup: boolean;
  updated_at: string;
}

export interface AnalyticsDay {
  restaurant_id: string;
  day: string;
  views: number;
  visitors: number;
}

/* ── شكل المنيو العام كما تُرجعه الدالة get_public_menu ─────────────────── */

export interface PublicOption {
  id: string;
  name: string;
  price_delta: number;
  is_available: boolean;
}

export interface PublicOptionGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  options: PublicOption[];
}

export interface PublicVariant {
  id: string;
  name: string;
  price: number;
  is_available: boolean;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  compare_at_price: number | null;
  badges: ProductBadge[];
  is_available: boolean;
  variants: PublicVariant[];
  option_groups: PublicOptionGroup[];
}

export interface PublicCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  products: PublicProduct[];
}

export interface PublicRestaurant {
  id: string;
  slug: string;
  short_id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  maps_url: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  show_unavailable: boolean;
  show_prices: boolean;
  accept_complaints: boolean;
}

export interface PublicHour {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface PublicOffer {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  badge_text: string | null;
}

export interface PublicMenu {
  restaurant: PublicRestaurant;
  theme: Omit<RestaurantTheme, 'restaurant_id' | 'updated_at'>;
  hours: PublicHour[];
  offers: PublicOffer[];
  categories: PublicCategory[];
}

/** الدالة قد تُرجع تحويلاً لرابط قديم، أو إشارة إلى مطعم موقوف، أو المنيو. */
export type PublicMenuResult =
  | { redirect_to: string }
  | { unavailable: true; name: string }
  | PublicMenu
  | null;
