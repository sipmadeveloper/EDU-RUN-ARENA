export type AvatarGender = 'male' | 'female';

export type AvatarColorId =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'black'
  | 'white'
  | 'cyan';

export type AvatarOutfitId = 'sprinter' | 'varsity' | 'pro' | 'champion';

export type AvatarPresetId =
  | 'custom'
  | 'cyber_racer'
  | 'striker_blue_red'
  | 'pirate_captain'
  | 'explorer_flashlight'
  | 'punk_mohawk'
  | 'street_cap_white'
  | 'alt_beanie_girl'
  | 'bacon_classic'
  | 'pink_neko_girl'
  | 'shades_goth_boy'
  | 'red_hoodie_boy'
  | 'black_jacket_boy'
  | 'blonde_cozy_girl'
  | 'skater_cap_girl'
  | 'gold_knight'
  | 'cardboard_bot'
  | 'builder_man'
  | 'red_pirate_girl'
  | 'classic_noob';

export interface AvatarConfig {
  gender: AvatarGender;
  color: AvatarColorId;
  outfit: AvatarOutfitId;
  presetId?: AvatarPresetId;
}

export interface AvatarPresetMeta {
  id: Exclude<AvatarPresetId, 'custom'>;
  name: string;
  category: 'aksi' | 'streetwear' | 'klasik';
  gender: AvatarGender;
  color: AvatarColorId;
  accentHex: string;
  desc: string;
}

export const AVATAR_PRESETS: AvatarPresetMeta[] = [
  {
    id: 'cyber_racer',
    name: 'Cyber Racer Merah',
    category: 'aksi',
    gender: 'female',
    color: 'red',
    accentHex: '#DC2626',
    desc: 'Helm kacamata cyan, masker respirator & zirah merah-putih',
  },
  {
    id: 'striker_blue_red',
    name: 'Striker Bola',
    category: 'aksi',
    gender: 'male',
    color: 'blue',
    accentHex: '#1D4ED8',
    desc: 'Rambut biru runcing & jersey garis merah-biru',
  },
  {
    id: 'pirate_captain',
    name: 'Kapten Bajak Laut',
    category: 'aksi',
    gender: 'male',
    color: 'orange',
    accentHex: '#9A3412',
    desc: 'Topi tricorn, rambut oranye panjang & sabuk perak',
  },
  {
    id: 'explorer_flashlight',
    name: 'Penjelajah Senter',
    category: 'aksi',
    gender: 'male',
    color: 'blue',
    accentHex: '#3B82F6',
    desc: 'Kaos biru emblem merah, ransel & senter menyala',
  },
  {
    id: 'punk_mohawk',
    name: 'Punk Mohawk Hijau',
    category: 'aksi',
    gender: 'male',
    color: 'black',
    accentHex: '#0D9488',
    desc: 'Mohawk hijau toska, jaket kulit hitam & sabuk perak',
  },
  {
    id: 'street_cap_white',
    name: 'Hoodie Putih Topi',
    category: 'streetwear',
    gender: 'male',
    color: 'white',
    accentHex: '#E2E8F0',
    desc: 'Topi abu, headphone hitam & hoodie putih santai',
  },
  {
    id: 'alt_beanie_girl',
    name: 'Beanie Lengan Belang',
    category: 'streetwear',
    gender: 'female',
    color: 'black',
    accentHex: '#1E293B',
    desc: 'Beanie hitam, kaos bintang & lengan belang hitam-putih',
  },
  {
    id: 'bacon_classic',
    name: 'Bacon Hair Klasik',
    category: 'streetwear',
    gender: 'male',
    color: 'blue',
    accentHex: '#9A5B25',
    desc: 'Rambut cokelat ikonik, jaket hitam & kaos biru',
  },
  {
    id: 'pink_neko_girl',
    name: 'Neko Pink Lucu',
    category: 'streetwear',
    gender: 'female',
    color: 'pink',
    accentHex: '#F472B6',
    desc: 'Headphone telinga kucing & setelan hoodie pink pastel',
  },
  {
    id: 'shades_goth_boy',
    name: 'Hoodie Kacamata Hitam',
    category: 'streetwear',
    gender: 'male',
    color: 'black',
    accentHex: '#0F172A',
    desc: 'Rambut hitam, kacamata gelap & hoodie grafis',
  },
  {
    id: 'red_hoodie_boy',
    name: 'Hoodie Merah Street',
    category: 'streetwear',
    gender: 'male',
    color: 'red',
    accentHex: '#DC2626',
    desc: 'Hoodie merah menyala, celana hitam & sepatu putih',
  },
  {
    id: 'black_jacket_boy',
    name: 'Jaket Hitam Strip',
    category: 'streetwear',
    gender: 'male',
    color: 'black',
    accentHex: '#334155',
    desc: 'Jaket hitam terbuka, kaos putih & celana strip putih',
  },
  {
    id: 'blonde_cozy_girl',
    name: 'Cardigan Krem Pirang',
    category: 'streetwear',
    gender: 'female',
    color: 'yellow',
    accentHex: '#FDE047',
    desc: 'Rambut pirang bergelombang & cardigan krem hangat',
  },
  {
    id: 'skater_cap_girl',
    name: 'Skater Topi Hitam-Putih',
    category: 'streetwear',
    gender: 'female',
    color: 'white',
    accentHex: '#475569',
    desc: 'Topi hitam-putih, rambut panjang & celana denim',
  },
  {
    id: 'gold_knight',
    name: 'Ksatria Emas-Merah',
    category: 'klasik',
    gender: 'male',
    color: 'yellow',
    accentHex: '#FACC15',
    desc: 'Helm & zirah ksatria emas-merah dengan pedang cahaya',
  },
  {
    id: 'cardboard_bot',
    name: 'Robot Kardus AOD',
    category: 'klasik',
    gender: 'male',
    color: 'orange',
    accentHex: '#C28E5C',
    desc: 'Kepala & badan kardus antena, lengan besi & sepatu merah',
  },
  {
    id: 'builder_man',
    name: 'Tukang Topi Kuning',
    category: 'klasik',
    gender: 'male',
    color: 'yellow',
    accentHex: '#EAB308',
    desc: 'Helm proyek kuning, hoodie abu & palu tukang',
  },
  {
    id: 'red_pirate_girl',
    name: 'Bajak Laut Merah',
    category: 'klasik',
    gender: 'female',
    color: 'red',
    accentHex: '#B91C1C',
    desc: 'Topi bajak laut tengkorak, syal & pedang cutlass',
  },
  {
    id: 'classic_noob',
    name: 'Noob Klasik',
    category: 'klasik',
    gender: 'male',
    color: 'yellow',
    accentHex: '#0EA5E9',
    desc: 'Kulit kuning ikonik, baju biru cerah & celana hijau',
  },
];

export const AVATAR_COLORS: Array<{ id: AvatarColorId; label: string; hex: string; accent: string }> = [
  { id: 'red', label: 'Merah', hex: '#EF4444', accent: '#FEE2E2' },
  { id: 'blue', label: 'Biru', hex: '#2563EB', accent: '#DBEAFE' },
  { id: 'green', label: 'Hijau', hex: '#10B981', accent: '#D1FAE5' },
  { id: 'yellow', label: 'Kuning', hex: '#FACC15', accent: '#FEF9C3' },
  { id: 'purple', label: 'Ungu', hex: '#8B5CF6', accent: '#EDE9FE' },
  { id: 'orange', label: 'Oranye', hex: '#F97316', accent: '#FFEDD5' },
  { id: 'pink', label: 'Pink', hex: '#EC4899', accent: '#FCE7F3' },
  { id: 'black', label: 'Hitam', hex: '#1E293B', accent: '#94A3B8' },
  { id: 'white', label: 'Putih', hex: '#F8FAFC', accent: '#3B82F6' },
  { id: 'cyan', label: 'Cyan', hex: '#06B6D4', accent: '#CFFAFE' },
];

export const AVATAR_OUTFITS: Array<{ id: AvatarOutfitId; label: string; desc: string }> = [
  { id: 'sprinter', label: 'Singlet Sprinter', desc: 'Jersey atletik klasik bernomor dada' },
  { id: 'varsity', label: 'Jaket Varsity', desc: 'Seragam tim sekolah dengan garis lengan' },
  { id: 'pro', label: 'Pro Aero Suit', desc: 'Kostum balap aerodinamis garis listrik' },
  { id: 'champion', label: 'Gold Tracksuit', desc: 'Seragam juara dengan aksen emas' },
];

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

export interface QuestionItem {
  id: string;
  subject: string;
  grade: string;
  questionType: QuestionType;
  prompt: string;
  options: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
  };
  correctAnswer?: string; // Never sent to student before answering!
  explanation?: string;
  teacherId?: string;
  createdAt?: string;
}

export type RaceVenueId = 'stadium_night' | 'stadium_day' | 'open_field';

export const RACE_VENUES: Array<{ id: RaceVenueId; label: string; shortLabel: string; desc: string }> = [
  {
    id: 'stadium_day',
    label: 'Stadion Siang Hari',
    shortLabel: 'Stadion Siang',
    desc: 'Stadion atletik internasional bermandikan cahaya matahari & langit biru cerah',
  },
  {
    id: 'stadium_night',
    label: 'Stadion Malam Hari',
    shortLabel: 'Stadion Malam',
    desc: 'Stadion megah di malam hari dengan sorot lampu stadion terang & gemerlap LED',
  },
  {
    id: 'open_field',
    label: 'Lapangan Luar Stadion',
    shortLabel: 'Lapangan Terbuka',
    desc: 'Arena lintasan balap di lapangan terbuka hijau dengan pepohonan & perbukitan',
  },
];

export interface RoomSettings {
  questionCount: number; // 1..50, default 50
  maxPlayers: number; // 2..30
  timePerQuestion: number; // seconds, e.g. 20
  baseSpeed: number; // m/s on track, e.g. 3
  boostDuration: number; // seconds, default 15
  penaltyDuration: number; // seconds, default 30
  allowShortAnswer: boolean;
  venue?: RaceVenueId;
  scheduledAt?: string;
}

export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface RoomSummary {
  id: string;
  code: string;
  name: string;
  subject: string;
  grade: string;
  teacherId: string;
  teacherName: string;
  schoolName: string;
  status: RoomStatus;
  settings: RoomSettings;
  questionCount?: number;
  totalLaps?: number;
  pointsPerQuestion?: number;
  maxScore?: number;
  participantCount: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export type RunnerEffectState = 'normal' | 'boost' | 'penalty' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  className: string;
  avatar: AvatarConfig;
  lane: number; // 0..29
  progress: number; // 0..1 (0 = start, 1 = finish line)
  distance: number; // meters along track
  speed: number; // current speed
  effectState: RunnerEffectState;
  effectExpiresAt: number; // timestamp ms
  currentQuestionIndex: number; // 0..questionCount
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  score: number; // dynamically scaled to max 100 based on questionCount
  connected: boolean;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  finishRank?: number;
  scoreRank?: number;
}

export interface AnswerReviewItem {
  questionIndex: number;
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  options: { A?: string; B?: string; C?: string; D?: string };
  submittedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  explanation: string;
  responseTimeMs: number;
}

export interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  schoolName: string;
  defaultSettings: RoomSettings;
}
