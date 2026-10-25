import styles from "./landing.module.css";

/** Original vector illustration: an illuminated rack inside flowing signal paths. */
export function RackArtwork() {
  return <div className={styles.artwork} aria-hidden="true">
    <div className={styles.artHalo} />
    <svg className={styles.artSvg} viewBox="0 0 760 690" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rackos-ribbon-a" x1="54" y1="90" x2="704" y2="542" gradientUnits="userSpaceOnUse"><stop stopColor="#D9FF70" stopOpacity="0" /><stop offset=".31" stopColor="#D9FF70" stopOpacity=".72" /><stop offset=".7" stopColor="#82CBBB" stopOpacity=".38" /><stop offset="1" stopColor="#A699FF" stopOpacity="0" /></linearGradient>
        <linearGradient id="rackos-ribbon-b" x1="115" y1="600" x2="705" y2="110" gradientUnits="userSpaceOnUse"><stop stopColor="#A699FF" stopOpacity="0" /><stop offset=".37" stopColor="#A699FF" stopOpacity=".8" /><stop offset=".72" stopColor="#A1F0CE" stopOpacity=".55" /><stop offset="1" stopColor="#A1F0CE" stopOpacity="0" /></linearGradient>
        <linearGradient id="rackos-face" x1="310" y1="145" x2="510" y2="560" gradientUnits="userSpaceOnUse"><stop stopColor="#45565C" /><stop offset=".42" stopColor="#26383D" /><stop offset="1" stopColor="#111E25" /></linearGradient>
        <linearGradient id="rackos-side" x1="504" y1="180" x2="580" y2="542" gradientUnits="userSpaceOnUse"><stop stopColor="#5F7477" /><stop offset="1" stopColor="#15242B" /></linearGradient>
        <filter id="rackos-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>

      <ellipse cx="395" cy="355" rx="275" ry="245" stroke="#D8EFDF" strokeOpacity=".11" />
      <ellipse cx="395" cy="355" rx="338" ry="305" stroke="#D8EFDF" strokeOpacity=".055" />
      <path className={styles.artOrbit} d="M18 433C137 586 198 213 377 305c131 67 184 227 366 77" stroke="url(#rackos-ribbon-a)" strokeWidth="78" strokeLinecap="round" opacity=".18" filter="url(#rackos-glow)" />
      <path className={styles.artOrbit} d="M18 433C137 586 198 213 377 305c131 67 184 227 366 77" stroke="url(#rackos-ribbon-a)" strokeWidth="2" />
      <path className={styles.artOrbitReverse} d="M33 204c163-201 238 270 398 184 120-65 156-212 311-105" stroke="url(#rackos-ribbon-b)" strokeWidth="64" strokeLinecap="round" opacity=".16" filter="url(#rackos-glow)" />
      <path className={styles.artOrbitReverse} d="M33 204c163-201 238 270 398 184 120-65 156-212 311-105" stroke="url(#rackos-ribbon-b)" strokeWidth="2" />
      {Array.from({ length: 11 }, (_, index) => <path key={index} d={`M-10 ${124 + index * 29}C164 ${53 + index * 11} 199 ${544 - index * 12} 425 ${219 + index * 19}S669 ${124 + index * 27} 780 ${226 + index * 22}`} stroke={index % 2 ? "#BCF5D6" : "#BAAFFF"} strokeOpacity={.035 + index * .004} strokeWidth="1" />)}

      <g className={styles.artRack}>
        <ellipse cx="422" cy="588" rx="151" ry="25" fill="#000" opacity=".55" filter="url(#rackos-glow)" />
        <path d="M307 168 388 133 557 171 502 196 307 168Z" fill="#6D8080" stroke="#A1C3B4" strokeOpacity=".45" />
        <path d="M502 196 557 171v372l-55 31V196Z" fill="url(#rackos-side)" stroke="#A1C3B4" strokeOpacity=".43" />
        <path d="M307 168 502 196v378l-195-29V168Z" fill="url(#rackos-face)" stroke="#C4E4D3" strokeOpacity=".58" />
        <path d="M324 194 484 216v332l-160-24V194Z" fill="#0A171D" stroke="#97B8AF" strokeOpacity=".55" />
        {Array.from({ length: 13 }, (_, index) => <g key={index}>
          <path d={`M331 ${211 + index * 24} 477 ${232 + index * 24}v18l-146-21v-18Z`} fill={index === 3 || index === 8 ? "#46655C" : index > 9 ? "#162931" : "#263A3D"} stroke="#A4C6B6" strokeOpacity={index === 3 || index === 8 ? ".48" : ".17"} />
          <path d={`m339 ${219 + index * 24} 52 7`} stroke="#D2E3D5" strokeOpacity=".19" strokeWidth="2" />
          <circle cx="458" cy={239 + index * 24} r="2.1" fill={index === 8 ? "#C7B6FF" : "#D9FF70"} className={styles.artLed} style={{ animationDelay: `${index * .22}s` }} />
        </g>)}
        <path d="M314 177v361M494 204v361M549 178v357" stroke="#D7F2DF" strokeOpacity=".34" strokeWidth="3" />
        <path d="M320 549v24m169-1v24m47-52v24" stroke="#B7C8C2" strokeWidth="6" strokeLinecap="round" />
      </g>
      <circle cx="128" cy="253" r="3" fill="#D9FF70" className={styles.artLed} />
      <circle cx="650" cy="173" r="3" fill="#B8AEFF" className={styles.artLed} />
      <circle cx="672" cy="515" r="2" fill="#D9FF70" className={styles.artLed} />
    </svg>
    <div className={styles.artStamp}><span className={styles.artStampDot} /> SYSTEM IN BALANCE <span>↗</span></div>
    <span className={styles.artCoordinate}>42U / A–B FEED / REV 01</span>
  </div>;
}
