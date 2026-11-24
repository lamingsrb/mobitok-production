import { z } from "zod";
import { ispravnaTabelaMarze, NAJVECA_GRANICA, NAJVECA_MARZA, NAJVISE_PRAGOVA } from "../pricing";

const phone = z
  .string()
  .trim()
  .min(7, "Unesite ispravan broj telefona.")
  .max(24)
  .regex(/^[+\d][\d\s()/-]+$/, "Unesite ispravan broj telefona.");
const name = z.string().trim().min(3, "Unesite ime i prezime.").max(120);

export const orderSchema = z
  .object({
    // Prodavnica vise ne salje ovo polje. Schema je strict, pa se prima samo
    // da zahtev iz stare, jos otvorene kartice u pregledacu ne bi pao na 400.
    // Vrednost se ignorise: da li je porudzbina probna odlucuje admin u panelu.
    demo: z.boolean().optional(),
    paymentMethod: z.enum(["cod", "card", "ips_qr"]).default("cod"),
    termsAccepted: z.boolean().optional(),
    idempotencyKey: z.uuid({ error: "Osvežite stranicu i pokušajte ponovo." }),
    customer: z
      .object({
        fullName: name,
        email: z
          .email({ error: "Unesite ispravnu e-mail adresu." })
          .max(254)
          .transform((v) => v.toLowerCase()),
        phone,
        address: z.string().trim().min(5, "Unesite ulicu i broj.").max(200),
        city: z.string().trim().min(2, "Unesite grad.").max(100),
        postalCode: z
          .string()
          .trim()
          .min(3, "Unesite poštanski broj.")
          .max(12)
          .regex(/^[\p{L}\d -]+$/u, "Unesite ispravan poštanski broj."),
        note: z.string().trim().max(1000).optional().default(""),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(100),
            quantity: z
              .number()
              .int()
              .min(1)
              .max(20, "Najviše 20 komada jednog artikla po porudžbini."),
          })
          .strict(),
      )
      .min(1, "Korpa je prazna.")
      .max(50)
      .refine(
        (items) =>
          new Set(items.map((item) => item.productId)).size === items.length,
        "Artikal može biti naveden samo jednom u korpi.",
      ),
  })
  .strict();

export const b2bSchema = z
  .object({
    companyName: z.string().trim().min(2, "Unesite naziv firme.").max(200),
    pib: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "PIB mora imati 9 cifara."),
    registrationNumber: z
      .string()
      .trim()
      .regex(/^\d{8}$/, "Matični broj mora imati 8 cifara.")
      .optional(),
    contactName: name,
    phone,
    city: z.string().trim().min(2, "Unesite grad.").max(100),
    address: z.string().trim().min(5, "Unesite adresu firme.").max(200),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "Poštanski broj ima 5 cifara.")
      .optional(),
  })
  .strict();

const deliveryCourier = z.string().trim().max(120);
const deliveryTime = z.string().trim().max(120);
const deliveryFee = z.number().min(0).max(100000);
const deliveryFreeOver = z.number().min(0).max(10000000);
const deliveryPrecision = "Unesite iznos sa najviše dve decimale.";

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_delivery"),
    deliveryCourier: deliveryCourier.nullable(),
    deliveryTime: deliveryTime.nullable(),
    deliveryFee: deliveryFee.multipleOf(0.01, deliveryPrecision).nullable(),
    deliveryFreeOver: deliveryFreeOver.multipleOf(0.01, deliveryPrecision).nullable(),
  }).strict(),
  z.object({
    action: z.literal("set_preparation_mode"),
    enabled: z.boolean(),
  }).strict(),
  z
    .object({
      action: z.literal("review_b2b"),
      applicationId: z.uuid(),
      status: z.enum(["approved", "rejected"]),
      discountPercent: z.number().min(0).max(60).default(0),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_order"),
      orderId: z.uuid(),
      status: z.enum(["received", "reviewing", "completed", "cancelled"]),
    })
    .strict(),
  // Podesavanja cena. Gornje granice su tu da omaska u unosu ne obori prodaju.
  z
    .object({
      action: z.literal("update_settings"),
      // Tabela marze po nabavnoj ceni sa PDV-om; poslednji red je bez gornje granice.
      marginTiers: z
        .array(
          z
            .object({
              up_to: z
                .number()
                .positive("Granica praga mora biti veća od nule.")
                .max(NAJVECA_GRANICA, "Granica praga može biti najviše 10.000.000 RSD.")
                .nullable(),
              percent: z
                .number()
                .min(0, "Marža ne može biti negativna.")
                .max(NAJVECA_MARZA, "Marža može biti najviše 500%."),
            })
            .strict(),
        )
        .min(1, "Tabela marže mora imati bar jedan red.")
        .max(NAJVISE_PRAGOVA, "Tabela marže može imati najviše 40 redova.")
        .refine(
          ispravnaTabelaMarze,
          "Granice marže moraju da rastu od reda do reda, a poslednji red ostaje bez gornje granice.",
        ),
      vatPercent: z.number().min(0).max(30),
      discountGuestPercent: z.number().min(0).max(60),
      discountPersonPercent: z.number().min(0).max(60),
      discountCompanyPercent: z.number().min(0).max(60),
      roundTo: z.number().min(0).max(1000),
      // Podaci koje softver ne moze da zna. Prazno znaci "jos nije dogovoreno"
      // i sajt tada ne prikazuje nista umesto toga.
      contactPhone: z.string().trim().max(40).default(""),
      contactEmail: z.union([z.literal(""), z.email().max(254)]).default(""),
      contactHours: z.string().trim().max(120).default(""),
      deliveryCourier: deliveryCourier.optional(),
      deliveryFee: deliveryFee.nullable().optional(),
      deliveryFreeOver: deliveryFreeOver.nullable().optional(),
      deliveryTime: deliveryTime.optional(),
      companyName: z.string().trim().max(200).default(""),
      companyShortName: z.string().trim().max(200).default(""),
      companyStartedOn: z.union([z.literal(""), z.iso.date()]).default(""),
      companyActivity: z.string().trim().max(200).default(""),
      companyPib: z.union([z.literal(""), z.string().regex(/^\d{9}$/, "PIB ima 9 cifara.")]).default(""),
      companyRegistrationNumber: z.union([z.literal(""), z.string().regex(/^\d{8}$/, "Matični broj ima 8 cifara.")]).default(""),
      companyAddress: z.string().trim().max(200).default(""),
    })
    .strict(),
]);
