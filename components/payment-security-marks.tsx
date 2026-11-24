import "./payment-security-marks.css";
/** Original brand artwork supplied with the merchant's bank integration package. */
export default function PaymentSecurityMarks({ language = "sr", compact = false }: { language?: "sr" | "en"; compact?: boolean }) {
  return <div className={`payment-security-marks${compact ? " is-compact" : ""}`}>
    <a className="payment-acceptance-marks" href="https://www.raiffeisenbank.rs/" target="_blank" rel="noopener noreferrer"><img src="/payments/card-brands.png" alt="Raiffeisen banka, Visa, Mastercard, DinaCard" width="332" height="42" loading="lazy" /></a>
    <div className="payment-authentication-marks" aria-label={language === "en" ? "Cardholder authentication" : "Potvrda identiteta korisnika kartice"}>
      <a href="https://rs.visa.com/run-your-business/small-business-tools/payment-technology/visa-secure.html" target="_blank" rel="noopener noreferrer"><img src="/payments/visa-secure.png" alt="Visa Secure" width="198" height="198" loading="lazy" /></a>
      <a href="https://www.mastercard.rs/sr-rs/korisnici/podrska/sigurnost-i-zastita/identity-check.html" target="_blank" rel="noopener noreferrer"><img src="/payments/mastercard-identity-check.png" alt="Mastercard Identity Check" width="2102" height="600" loading="lazy" /></a>
    </div>
    {!compact && <p>{language === "en" ? "Card details are entered on the bank’s secure page. Available payment methods are shown above." : "Podatke kartice unosite na sigurnoj stranici banke. Dostupni načini plaćanja prikazani su iznad."}</p>}
  </div>;
}
