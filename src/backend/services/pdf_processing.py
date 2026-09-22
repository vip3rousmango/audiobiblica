"""PDF processing service for extracting knowledge from audio equipment manuals."""

import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from datetime import datetime

from src.backend.models.equipment import Manual


@dataclass
class PDFProcessingResult:
    """Result of PDF processing."""
    manual: Manual
    full_text: str
    extracted_features: Dict[str, Any]
    quality_score: float  # How well the PDF was processed


class PDFProcessor:
    """Processes audio equipment PDF manuals to extract structured knowledge."""
    
    # Patterns common in audio equipment manuals
    PATTERNS = {
        "input_voltage": r"(?:input\s+voltage|voltage\s*input|power\s*input)[\s:]+([0-9.\sV]+)",
        "output_voltage": r"(?:output\s+voltage|voltage\s*output|output\s*voltage)[\s:]+([0-9.\sV]+)",
        "output_power": r"(?:output\s+power|power\s*output|max\s+power)[\s:]+([0-9.\sW]+)",
        "weight": r"(?:weight|mass)[\s:]+([0-9.\s]+)\s*(?:kg|g|lbs|lb)",
        "dimensions": r"(?:dimensions|size)[\s:]+([0-9.\sx]+)\s*(?:mm|cm|in|mm×)",
        "frequency_response": r"(?:frequency\s+response|freq.*response)[\s:]+([0-9.\s,-Hz]+)",
        "signal_to_noise": r"(?:signal.?to.?noise|snr|signal-to-noise)[\s:]+([0-9.\s]+)",
        "diameter": r"(?:driver\s+diameter|woofer|driver)[\s:]+([0-9.\s]+)\s*(?:in|cm|mm)",
        "crossover_frequency": r"(?:crossover|x-over)\s*[:=]?\s*([0-9.\s]+)\s*(?:Hz|kHz)",
    }
    
    def process_pdf(self, pdf_path: str, equipment_id: str) -> PDFProcessingResult:
        """Process a single PDF manual."""
        from pypdf import PdfReader
        
        reader = PdfReader(pdf_path)
        full_text = ""
        
        # Extract text from all pages
        for page in reader.pages:
            text = page.extract_text()
            if text:
                full_text += text + "\n"
        
        # Extract features using patterns
        extracted_features = self._extract_features(full_text)
        
        # Create manual record
        manual = Manual(
            path=pdf_path,
            title=Path(pdf_path).stem,
            equipment_id=equipment_id,
            extracted_text=full_text[:5000] if full_text else None,  # Truncate for storage
            extracted_features=extracted_features,
            processed_at=datetime.now(),
        )
        
        return PDFProcessingResult(
            manual=manual,
            full_text=full_text,
            extracted_features=extracted_features,
            quality_score=self._calculate_quality_score(full_text),
        )
    
    def _extract_features(self, text: str) -> Dict[str, Any]:
        """Extract equipment features from manual text."""
        features = {}
        
        for key, pattern in self.PATTERNS.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                features[key] = match.group(1).strip()
        
        # Also try to find model/serial numbers
        model_match = re.search(r"(?:model|modell|type)[\s:]+([A-Za-z0-9\s\-]+)", text, re.IGNORECASE)
        if model_match:
            features["mentioned_model"] = model_match.group(1).strip()
        
        return features
    
    def _calculate_quality_score(self, text: str) -> float:
        """Calculate processing quality score (0.0 to 1.0)."""
        if not text or len(text) < 100:
            return 0.0
        
        # Score based on text length and pattern matches
        score = min(len(text) / 5000, 1.0)  # Length component
        
        # Pattern match bonus
        pattern_hits = len(self.PATTERNS)
        matched = sum(1 for p in self.PATTERNS.values() if re.search(p, text, re.IGNORECASE))
        score += (matched / pattern_hits) * 0.3
        
        return min(score, 1.0)


pdf_processor = PDFProcessor()