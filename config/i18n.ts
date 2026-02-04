export interface Translations {
  welcome: string;
  skipButton: string;
  signUp: string;
  alreadyHaveAccount: string;
  signInWithGoogle: string;
  signInWithFacebook: string;
  signInWithEmail: string;
  username: string;
  acceptTerms: string;
  termsAndConditions: string;
  privacyPolicy: string;
  continue: string;
  signIn: string;
  email: string;
  password: string;
  forgotPassword: string;
  home: string;
  search: string;
  sell: string;
  messages: string;
  profile: string;
  // Articles
  size: string;
  soldBy: string;
  likes: string;
  views: string;
  // Navigation
  back: string;
  next: string;
  // Common
  loading: string;
  error: string;
  success: string;
  cancel: string;
  save: string;
  // Optional extended dictionaries
  labels?: {
    color: string;
    material: string;
    condition: string;
    chooseColor?: string;
    chooseMaterial?: string;
  };
  colors?: Record<string, string>; // key: internal/color name, value: localized label
  materials?: Record<string, string>; // key: internal/material name, value: localized label
  conditions?: Record<string, string>; // key: condition value, value: label
}

export const translations: Record<string, Translations> = {
  fr: {
    welcome: "Bienvenue sur Vinted Clone",
    skipButton: "Ignorer",
    signUp: "S'inscrire",
    alreadyHaveAccount: "J'ai déjà un compte",
    signInWithGoogle: "Continuer avec Google",
    signInWithFacebook: "Continuer avec Facebook", 
    signInWithEmail: "Continuer avec l'email",
    username: "Nom d'utilisateur",
    acceptTerms: "J'accepte les",
    termsAndConditions: "Conditions générales",
    privacyPolicy: "Politique de confidentialité",
    continue: "Continuer",
    signIn: "Se connecter",
    email: "Adresse email",
    password: "Mot de passe",
    forgotPassword: "Mot de passe oublié ?",
    home: "Accueil",
    search: "Recherche", 
    sell: "Vendre",
    messages: "Messages",
    profile: "Profil",
    size: "Taille",
    soldBy: "Vendu par",
    likes: "likes",
    views: "vues",
    back: "Retour",
    next: "Suivant",
    loading: "Chargement...",
    error: "Erreur",
    success: "Succès",
    cancel: "Annuler",
    save: "Enregistrer",
    labels: {
      color: "Couleur",
      material: "Matière",
      condition: "État",
      chooseColor: "Sélectionner une couleur",
      chooseMaterial: "Sélectionner une matière",
    },
    colors: {
      Noir: "Noir",
      Marron: "Marron",
      Gris: "Gris",
      Beige: "Beige",
      Fuchsia: "Fuchsia",
      Violet: "Violet",
      Rouge: "Rouge",
      Jaune: "Jaune",
      Bleu: "Bleu",
      Vert: "Vert",
      Orange: "Orange",
      Blanc: "Blanc",
      Argenté: "Argenté",
      Doré: "Doré",
      Multicolore: "Multicolore",
      Kaki: "Kaki",
      Turquoise: "Turquoise",
      Crème: "Crème",
      Abricot: "Abricot",
      Corail: "Corail",
      Bordeaux: "Bordeaux",
      Rose: "Rose",
      Lila: "Lila",
      "Bleu clair": "Bleu clair",
      Marine: "Marine",
      "Vert foncé": "Vert foncé",
      "Vert clair": "Vert clair",
      Moutarde: "Moutarde",
      Menthe: "Menthe",
      Ivoire: "Ivoire",
      Taupe: "Taupe",
      Camel: "Camel",
      Saumon: "Saumon",
      Prune: "Prune",
    },
    materials: {
      Acier: "Acier",
      Acrylique: "Acrylique",
      Alpaga: "Alpaga",
      Argent: "Argent",
      Bambou: "Bambou",
      Bois: "Bois",
      Cachemire: "Cachemire",
      Caoutchouc: "Caoutchouc",
      Carton: "Carton",
      Coton: "Coton",
      Cuir: "Cuir",
      "Cuir synthétique": "Cuir synthétique",
      "Cuir verni": "Cuir verni",
      Céramique: "Céramique",
      Daim: "Daim",
      Denim: "Denim",
      Dentelle: "Dentelle",
      Duvet: "Duvet",
      "Fausse fourrure": "Fausse fourrure",
      Feutre: "Feutre",
      Flanelle: "Flanelle",
      Jute: "Jute",
      Laine: "Laine",
      Latex: "Latex",
      Lin: "Lin",
      Maille: "Maille",
      Mohair: "Mohair",
      Mousse: "Mousse",
      Mousseline: "Mousseline",
      Mérinos: "Mérinos",
      Métal: "Métal",
      Nylon: "Nylon",
      Néoprène: "Néoprène",
      Or: "Or",
      Paille: "Paille",
      Papier: "Papier",
      Peluche: "Peluche",
      Pierre: "Pierre",
      Plastique: "Plastique",
      Polaire: "Polaire",
      Polyester: "Polyester",
      Porcelaine: "Porcelaine",
      Rotin: "Rotin",
      Satin: "Satin",
      Sequins: "Sequins",
      Silicone: "Silicone",
      Soie: "Soie",
      Toile: "Toile",
      Tulle: "Tulle",
      Tweed: "Tweed",
      Velours: "Velours",
      "Velours côtelé": "Velours côtelé",
      Verre: "Verre",
      Viscose: "Viscose",
    },
    conditions: {
      neuf: "Neuf avec étiquettes",
      "très bon état": "Très bon état",
      "bon état": "Bon état",
      satisfaisant: "Satisfaisant",
    },
  },
  en: {
    welcome: "Welcome to Vinted Clone",
    skipButton: "Skip",
    signUp: "Sign Up",
    alreadyHaveAccount: "I already have an account",
    signInWithGoogle: "Continue with Google",
    signInWithFacebook: "Continue with Facebook",
    signInWithEmail: "Continue with Email", 
    username: "Username",
    acceptTerms: "I accept the",
    termsAndConditions: "Terms and Conditions",
    privacyPolicy: "Privacy Policy",
    continue: "Continue",
    signIn: "Sign In",
    email: "Email address", 
    password: "Password",
    forgotPassword: "Forgot password?",
    home: "Home",
    search: "Search",
    sell: "Sell",
    messages: "Messages", 
    profile: "Profile",
    size: "Size",
    soldBy: "Sold by",
    likes: "likes",
    views: "views",
    back: "Back",
    next: "Next",
    loading: "Loading...",
    error: "Error",
    success: "Success",
    cancel: "Cancel",
    save: "Save",
    labels: {
      color: "Color",
      material: "Material",
      condition: "Condition",
      chooseColor: "Choose a color",
      chooseMaterial: "Choose a material",
    },
    colors: {},
    materials: {},
    conditions: {
      neuf: "New with tags",
      "très bon état": "Very good condition",
      "bon état": "Good condition",
      satisfaisant: "Satisfactory",
    },
  },
  es: {
    welcome: "Bienvenido a Vinted Clone",
    skipButton: "Saltar",
    signUp: "Registrarse",
    alreadyHaveAccount: "Ya tengo una cuenta",
    signInWithGoogle: "Continuar con Google",
    signInWithFacebook: "Continuar con Facebook",
    signInWithEmail: "Continuar con Email",
    username: "Nombre de usuario",
    acceptTerms: "Acepto los",
    termsAndConditions: "Términos y Condiciones",
    privacyPolicy: "Política de Privacidad",
    continue: "Continuar",
    signIn: "Iniciar Sesión",
    email: "Dirección de correo",
    password: "Contraseña",
    forgotPassword: "¿Olvidaste tu contraseña?",
    home: "Inicio",
    search: "Buscar",
    sell: "Vender",
    messages: "Mensajes",
    profile: "Perfil",
    size: "Talla",
    soldBy: "Vendido por",
    likes: "me gusta",
    views: "vistas",
    back: "Atrás",
    next: "Siguiente",
    loading: "Cargando...",
    error: "Error",
    success: "Éxito",
    cancel: "Cancelar",
    save: "Guardar",
    labels: {
      color: "Color",
      material: "Material",
      condition: "Estado",
      chooseColor: "Elegir un color",
      chooseMaterial: "Elegir un material",
    },
    colors: {},
    materials: {},
    conditions: {
      neuf: "Nuevo con etiquetas",
      "très bon état": "Muy buen estado",
      "bon état": "Buen estado",
      satisfaisant: "Satisfactorio",
    },
  },
  de: {
    welcome: "Willkommen bei Vinted Clone",
    skipButton: "Überspringen",
    signUp: "Registrieren",
    alreadyHaveAccount: "Ich habe bereits ein Konto",
    signInWithGoogle: "Mit Google fortfahren",
    signInWithFacebook: "Mit Facebook fortfahren",
    signInWithEmail: "Mit E-Mail fortfahren",
    username: "Benutzername",
    acceptTerms: "Ich akzeptiere die",
    termsAndConditions: "Allgemeinen Geschäftsbedingungen",
    privacyPolicy: "Datenschutzrichtlinie",
    continue: "Fortfahren",
    signIn: "Anmelden",
    email: "E-Mail-Adresse",
    password: "Passwort",
    forgotPassword: "Passwort vergessen?",
    home: "Startseite",
    search: "Suchen",
    sell: "Verkaufen",
    messages: "Nachrichten",
    profile: "Profil",
    size: "Größe",
    soldBy: "Verkauft von",
    likes: "Gefällt mir",
    views: "Aufrufe",
    back: "Zurück",
    next: "Weiter",
    loading: "Lädt...",
    error: "Fehler",
    success: "Erfolg",
    cancel: "Abbrechen",
    save: "Speichern",
    labels: {
      color: "Farbe",
      material: "Material",
      condition: "Zustand",
      chooseColor: "Farbe auswählen",
      chooseMaterial: "Material auswählen",
    },
    colors: {},
    materials: {},
    conditions: {
      neuf: "Neu mit Etiketten",
      "très bon état": "Sehr guter Zustand",
      "bon état": "Guter Zustand",
      satisfaisant: "Zufriedenstellend",
    },
  }
};

export const languages = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
];